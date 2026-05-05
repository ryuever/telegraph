---
id: D-002
title: Flue 框架的 PI 集成模式与 Role/Connector 机制分析
description: >
  分析 Flue（withastro/flue）如何集成 PI（pi-agent-core + pi-ai）作为嵌入式运行时，
  详细阐述 Role 角色指令系统和 Connector 第三方服务适配机制，并探讨对 Telegraph 的借鉴价值。
category: discussion
created: 2026-05-06
updated: 2026-05-06
tags: [flue, pi-agent, role-system, connector, architecture]
status: final
sources:
  - title: "withastro/flue GitHub"
    url: "https://github.com/withastro/flue"
references:
  - id: A-005
    rel: extends
    file: ../architecture/20260505-telegraph-agent-runtime-extension-host-theory.md
---

## 概述

Flue 是 Astro 团队开源的 **Agent Harness Framework**（代理驾驭框架），设计理念是「像使用 Claude Code 一样构建 headless 代理」。本文分析其与 PI 的集成方式、核心抽象机制，并探讨对 Telegraph 的借鉴价值。

## Flue 与 PI 的集成模式

### Embedded 模式（非 Spawn）

Flue **不是 spawn 模式**，而是 **embedded（嵌入式）模式**。它直接在进程内使用 `@mariozechner/pi-agent-core` 的 `Agent` 类：

```typescript
// packages/sdk/src/session.ts:189
this.harness = new Agent({
  initialState: {
    systemPrompt,
    model: this.config.model,
    tools,
    messages: previousMessages,
  },
  getApiKey: (provider) => this.getProviderApiKey(provider),
  toolExecution: 'parallel',
});
```

这意味着 PI Agent 与 Flue 运行在**同一个 Node.js 进程**内，没有子进程被 spawn。

### PI 生态依赖

| 包 | 作用 |
|---|------|
| `@mariozechner/pi-agent-core` | 核心 `Agent` 类、工具执行、消息处理 |
| `@mariozechner/pi-ai` | 模型解析（`getModel`）、Provider 配置 |
| `just-bash` | 虚拟沙箱（默认）或自定义 Bash 运行时 |

## Role 角色指令系统

### 定义格式

Role 是 Markdown 文件，放在 `roles/` 或 `.flue/roles/` 目录：

```markdown
---
description: A friendly greeter that welcomes users with enthusiasm
model: anthropic/claude-sonnet-4-6
---

## Mission

You are the official greeter. Your job is to welcome users warmly...
```

字段说明：

| 字段 | 必填 | 作用 |
|------|------|------|
| `name` | ✅ | 通过 frontmatter `name:` 或文件名 |
| `description` | ✅ | 供 LLM 理解 role 职责 |
| `model` | ❌ | 覆盖默认模型 |
| `instructions` | ✅ | Markdown 主体，系统 prompt 的追加内容 |

### 层级优先级

Role 可在 **4 个层级** 指定，优先级依次升高：

```
Agent 初始化 → Session 创建 → prompt()/skill() 调用 → task() 调用
   (init)         (session)        (prompt/skill)       (task)
```

优先级：**call role > session role > agent role**

```typescript
// 1. Agent 级别默认 role
const agent = await init({ 
  model: 'anthropic/claude-sonnet-4-6',
  role: 'coder'  // 所有 session 继承
});

// 2. Session 级别覆盖
const session = await agent.session('thread-1', { role: 'reviewer' });

// 3. prompt 级别覆盖
await session.prompt('fix this bug', { role: 'fixer' });
```

### 系统 Prompt 注入

Role 指令被追加到系统 prompt：

```typescript
// session.ts:438
private buildSystemPrompt(roleName?: string): string {
  // ... agent.md, skills 等基础内容
  if (roleName) {
    const role = this.config.roles[roleName];
    parts.push(`<role name="${role.name}">\n${role.instructions}\n</role>`);
  }
  return parts.join('\n\n');
}
```

生成的系统 prompt 结构：

```
[AGENTS.md 内容]

## Available Skills
- **skill-name** - description

<role name="reviewer">
## Mission
You are a code reviewer...
</role>
```

### Role 模型覆盖

Role 中指定 `model` 可实现：
- 简单任务用小模型（成本低）
- 复杂任务用大模型

### 核心实现文件

| 文件 | 职责 |
|------|------|
| `types.ts:16-22` | `Role` 接口定义 |
| `roles.ts` | Role 存在性校验、解析、模型解析 |
| `session.ts:392-411` | 有效 role 解析、模型解析 |
| `session.ts:438-445` | 系统 prompt 注入 |

## Connector 第三方服务适配机制

### 本质

Connector 是 **"让 AI 帮你写适配代码"** 的机制。本质是 Markdown 安装指引 + TypeScript 适配器。

### 目录结构

```
connectors/
├── sandbox.md           # 分类根（如"sandbox"类别的通用说明）
├── sandbox--daytona.md  # 具体 connector（分类--名称）
└── sandbox--vercel.md
```

### 文件格式

每个 `.md` 文件包含：

| 部分 | 作用 |
|------|------|
| **Frontmatter** | 元数据（category, website, aliases） |
| **"What this connector does"** | 说明这个 connector 做什么 |
| **"Where to write the file"** | 告诉 AI 把代码写到哪里 |
| **"File contents"** | 要写入的 TypeScript 代码模板 |

### 使用方式

```bash
# 列出所有 connectors
flue add

# 安装 connector（输出安装指令给 AI agent）
flue add daytona | claude
```

### 核心功能

以 Daytona 为例，connector 把第三方 SDK 适配成 Flue 的 `SandboxFactory` 接口：

```typescript
// connectors/daytona.ts（由 connector 自动生成）
import { createSandboxSessionEnv } from '@flue/sdk/sandbox';
import type { SandboxApi } from '@flue/sdk/sandbox';
import { Sandbox as DaytonaSandbox } from '@daytona/sdk';

class DaytonaSandboxApi implements SandboxApi {
  async readFile(path: string): Promise<string> { ... }
  async writeFile(path: string, content: string): Promise<void> { ... }
  // ...其他文件系统方法
}

export function daytona(sandbox: DaytonaSandbox): SandboxFactory {
  return {
    createSessionEnv: async (cwd) => createSandboxSessionEnv(new DaytonaSandboxApi(sandbox), cwd)
  };
}
```

使用：

```typescript
const agent = await init({ 
  sandbox: daytona(daytonaSandbox),
  model: 'anthropic/claude-sonnet-4-6'
});
```

## 对 Telegraph 的借鉴建议

### 1. Role 系统可迁移

Telegraph 目前只有消息角色（user/assistant/system/tool），缺乏业务层面的角色抽象。

| 阶段 | 任务 | 价值 |
|------|------|------|
| Phase 1 | 添加 `Role` 类型 + `discoverRoles()` | 基础设施 |
| Phase 2 | `init({ role })` + `session(, { role })` | 核心 API |
| Phase 3 | `prompt(, { role })` 级别覆盖 | 灵活切换 |
| Phase 4 | Role 中的 `model` 字段覆盖 | 成本优化 |

### 2. 与现有 Extension 的关系

当前 Telegraph 已有 Extension 系统：
- **Extension** = 工具能力的扩展
- **Role** = 行为/指令的扩展

两者不冲突，可叠加使用：

```typescript
const agent = await init({ 
  role: 'debugger',
  tools: [...extensions]  // Extension 提供的工具
});
```

### 3. Connector 机制的适用性

Flue 的 Connector 机制是针对 sandbox 适配的。对于 Telegraph：
- **不直接适用**：Telegraph 的沙箱模式与 Flue 不同
- **可借鉴思想**：可以用类似方式简化 MCP 工具、文件系统工具的集成
- **更直接的路径**：MCP 已有 `connectMcpServer()`，可考虑包装为 "MCP Connector"

## 相关文档

- [A-005: Telegraph Agent Runtime 与 Extension Host 理论基础](./../architecture/20260505-telegraph-agent-runtime-extension-host-theory.md)