# Chat & Design Applications Integration Guide

本指南说明如何在 Telegraph 应用中集成 Chat 和 Design 应用进程，并通过 RPC 验证数据通信。

## 目录

- [应用架构](#应用架构)
- [构建应用](#构建应用)
- [启动应用](#启动应用)
- [Renderer 侧集成](#renderer-侧集成)
- [验证通信](#验证通信)

## 应用架构

### 三个独立的应用进程

```
┌─────────────────────────────────────┐
│      Telegraph Main Renderer        │
│  (React UI + RPC Client Channel)    │
└──────┬──────────────┬───────────────┘
       │              │
       ▼              ▼
┌──────────────┐  ┌──────────────┐
│ Chat Process │  │Design Process│
│ (Node.js)    │  │ (Node.js)    │
└──────────────┘  └──────────────┘
```

### 进程通信流程

1. **启动阶段**: Telegraph main process 预创建 Chat/Design 应用的 UtilityProcess
2. **连接阶段**: Renderer 通过 `PageletClientChannel` 建立 MessagePort 连接到各进程
3. **通信阶段**: Renderer 通过 RPC 代理客户端调用远程服务方法
4. **验证阶段**: 调用 `ping()` 方法验证连通性

## 构建应用

### 1. 构建 Chat 应用

```bash
cd apps/chat
pnpm build
```

输出: `apps/chat/.vite/build/index.js`

### 2. 构建 Design 应用

```bash
cd apps/design
pnpm build
```

输出: `apps/design/.vite/build/index.js`

### 3. 全量构建（从项目根目录）

```bash
pnpm -r build
# 或针对特定应用
pnpm --filter chat build
pnpm --filter design build
```

## 启动应用

### 选项 1: 通过 Telegraph 应用自动启动

Telegraph 应用的 `TelegraphApplication` 在初始化时会预创建 Chat/Design 的 PageletProcess：

```typescript
// apps/telegraph/src/application/telegraph-application.ts (line 263-271)
private warmupInlinePageletProcesses() {
  const mainWindow = this.windowManager.getMainWindow()
  if (!mainWindow) return
  const inlinePanels = ['chat', 'design']
  for (const projectName of inlinePanels) {
    mainWindow.ensurePageletProcess(projectName, this.workbench)
  }
}
```

启动 Telegraph：

```bash
cd apps/telegraph
pnpm start  # electron-forge dev 模式
```

### 选项 2: 独立启动应用（用于测试）

```bash
# 终端 1: 启动 Chat 进程
node apps/chat/.vite/build/index.js

# 终端 2: 启动 Design 进程
node apps/design/.vite/build/index.js

# 终端 3: 启动 Telegraph (需要自定义连接方式)
cd apps/telegraph && pnpm start
```

## Renderer 侧集成

### 1. 定义服务接口

在你的 renderer 代码中定义服务类型：

```typescript
// 在 packages/ui 或 apps/telegraph 中

export interface ChatService {
  ping(payload?: { ts: number }): Promise<{
    pong: true
    processId: string
    projectName: string
    ts: number
    receivedTs?: number
  }>
  getMessage(id: string): Promise<{ id: string; text: string; timestamp: number }>
  sendMessage(text: string): Promise<{ id: string; text: string; timestamp: number }>
}

export interface DesignService {
  ping(payload?: { ts: number }): Promise<{
    pong: true
    processId: string
    projectName: string
    ts: number
    receivedTs?: number
  }>
  getDesign(id: string): Promise<{ id: string; name: string; content: string; timestamp: number }>
  saveDesign(name: string, content: string): Promise<{ id: string; name: string; content: string; timestamp: number }>
}
```

### 2. 创建 RPC 客户端

在 Renderer 进程中创建 RPC 代理客户端：

```typescript
import { RPCProxyClient } from '@x-oasis/async-call-rpc-web'

// 获取 MessagePort（来自 PageletClientChannel）
const chatPort = await pageletClientChannel.getPort('chat')
const designPort = await pageletClientChannel.getPort('design')

// 创建 RPC 代理客户端
const chatService = new RPCProxyClient<ChatService>({
  channel: new MessagePortChannel(chatPort),
  remotePath: '/chat-service',
})

const designService = new RPCProxyClient<DesignService>({
  channel: new MessagePortChannel(designPort),
  remotePath: '/design-service',
})
```

### 3. 在 React 组件中使用

```typescript
import { useEffect, useState } from 'react'

export function ChatPanel() {
  const [chatService, setChatService] = useState<ChatService | null>(null)
  const [pingResult, setPingResult] = useState(null)

  useEffect(() => {
    // 初始化 RPC 客户端（如上所述）
    const client = new RPCProxyClient<ChatService>({
      channel: messagePort,
      remotePath: '/chat-service',
    })
    setChatService(client)
  }, [])

  const handlePing = async () => {
    if (!chatService) return
    try {
      const result = await chatService.ping({ ts: Date.now() })
      setPingResult(result)
      console.log('Chat service is alive:', result)
    } catch (error) {
      console.error('Chat service ping failed:', error)
    }
  }

  const handleSendMessage = async (text: string) => {
    if (!chatService) return
    try {
      const msg = await chatService.sendMessage(text)
      console.log('Message sent:', msg)
    } catch (error) {
      console.error('Failed to send message:', error)
    }
  }

  return (
    <div>
      <button onClick={handlePing}>Test Ping</button>
      {pingResult && <pre>{JSON.stringify(pingResult, null, 2)}</pre>}
      <button onClick={() => handleSendMessage('Hello')}>Send Message</button>
    </div>
  )
}
```

## 验证通信

### 检查进程日志

Chat 应用日志:
```bash
tail -f /tmp/chat-process.log
```

Design 应用日志:
```bash
tail -f /tmp/design-process.log
```

Telegraph main 日志:
```bash
tail -f /tmp/telegraph-main.log
```

### 验证步骤

1. **启动应用**
   ```bash
   pnpm start  # 在 apps/telegraph 目录
   ```

2. **检查进程创建**
   - 验证 `/tmp/chat-process.log` 和 `/tmp/design-process.log` 存在且有日志
   - 查看 "start() returned; keeping process alive" 的日志

3. **在 Renderer 中测试**
   - 打开开发者工具 (DevTools)
   - 在控制台中调用 ping:
     ```javascript
     await chatService.ping({ ts: Date.now() })
     // 预期输出: { pong: true, processId: "...", projectName: "chat", ... }
     ```

4. **验证往返延迟**
   - 比较 `receivedTs - ts` 获得 Renderer → Process 延迟
   - 检查返回的 `ts` 获得 Process 端时间戳

### 常见问题排查

| 问题 | 症状 | 解决方案 |
|------|------|--------|
| 进程未启动 | 日志文件不存在 | 检查 `warmupInlinePageletProcesses` 是否被调用 |
| RPC 连接失败 | 超时或连接拒绝 | 验证进程是否已启动，检查 MessagePort 是否正确传递 |
| 方法调用超时 | 等待响应超时 | 检查进程日志，验证 RPC 路径是否正确 |
| 序列化错误 | 无法序列化返回值 | 确保返回值包含可序列化的数据，避免函数/Symbol 等 |

## 相关文件

- Chat 应用: `apps/chat/`
- Design 应用: `apps/design/`
- Telegraph 应用: `apps/telegraph/`
- PageletProcess 实现: `apps/telegraph/src/services/process/pagelet-process/`
- 端口管理: `apps/telegraph/src/services/port-manager/`
- 窗口管理: `apps/telegraph/src/services/window-manager/`

## 后续优化方向

1. **提取共享契约**: 将 ChatService/DesignService 接口移到 `@telegraph/runtime-contracts`
2. **自动代码生成**: 从接口定义自动生成 Renderer 侧的 RPC 客户端代码
3. **统一错误处理**: 实现跨进程的错误追踪和重试机制
4. **性能监控**: 记录 RPC 调用的延迟和吞吐量
5. **进程池管理**: 支持多个 Chat/Design 实例，实现负载均衡
