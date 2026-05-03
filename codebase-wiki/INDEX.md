---
layout: home

hero:
  name: "Telegraph Wiki"
  text: "源码阅读与概念笔记"
  tagline: 架构分析 · 技术讨论 · 参考手册 · 路线图
  actions:
    - theme: brand
      text: 文档索引
      link: /INDEX#文档索引
    - theme: alt
      text: 书写规范
      link: /CONVENTIONS

features:
  - title: 架构分析
    details: 模块职责、依赖与系统设计笔记。
    link: /INDEX
  - title: 技术讨论
    details: 方案对比、概念辨析与深度笔记。
    link: /INDEX
  - title: 参考手册
    details: 目录结构与速查。
    link: /INDEX
  - title: 规划路线
    details: 差距分析、优先级与待办。
    link: /INDEX
---

> 本目录（`codebase-wiki/`）存放 AI 辅助生成的分析文档、技术讨论、参考手册与规划路线。  
> 书写规范请参考 [CONVENTIONS.md](./CONVENTIONS.md)（也可在仓库中直接打开该文件）。

在分类子目录下添加首篇文档后，在仓库根目录运行 skill 自带的 `regenerate-sidebar.mjs` 以更新侧栏与导航。

## 文档索引

### architecture/ — 架构分析

| # | 文件 | 标题 | 概述 |
|---|------|------|------|
| A-001 | [20260504-di-and-cross-platform-paradigm.md](./architecture/20260504-di-and-cross-platform-paradigm.md) | Telegraph DI 容器与多平台代码维护范式 | 剖析 `@x-oasis/di` 容器、`common/node/electron-main/browser` 跨平台目录分层与"同接口跨进程"的 RPC 代理范式，沉淀新增服务的开发规范。 |
| A-002 | [20260504-multi-process-topology.md](./architecture/20260504-multi-process-topology.md) | Telegraph 多进程拓扑（main / daemon / shared / pagelet / preload / renderer） | 五大进程角色的职责定位、构建配置、启动顺序与端口握手；端口经纪人 + RPC 路由全貌。 |
| A-003 | [20260504-stability-and-performance-monitoring.md](./architecture/20260504-stability-and-performance-monitoring.md) | Telegraph 性能与稳定性监控体系 | 七个监控维度（崩溃 / 性能 / 心跳 / 日志 / 诊断快照 / 端口健康 / 错误边界）展开，并标注代码层差距与改进项。 |

### discussion/ — 技术讨论

| # | 文件 | 标题 | 概述 |
|---|------|------|------|
|  |  |  |  |

### reference/ — 参考手册

| # | 文件 | 标题 | 概述 |
|---|------|------|------|
|  |  |  |  |

### roadmap/ — 规划路线

| # | 文件 | 标题 | 概述 |
|---|------|------|------|
|  |  |  |  |
