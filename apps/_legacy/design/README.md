# Design Application

一个简单的 Node.js 进程应用，通过 RPC 暴露 Design 服务。

## 目录结构

```
design/
├── src/
│   ├── application/
│   │   ├── design-application.ts       # Design 应用主类，实现 DesignService 接口
│   │   └── design-application-module.ts # DI 容器配置
│   └── main.ts                         # 应用入口，初始化和启动应用
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 如何构建

```bash
cd apps/design
pnpm build
```

构建产物将输出到 `.vite/build/index.js`

## 如何运行

```bash
node .vite/build/index.js
```

或通过 electron UtilityProcess 运行（由 telegraph 应用管理）

## 暴露的服务

### DesignService (RPC path: `/design-service`)

- **ping(payload?)**: 验证通信是否正常
  - 返回: `{ pong: true; processId: string; projectName: 'design'; ts: number; receivedTs?: number }`

- **getDesign(id: string)**: 获取设计
  - 返回: `{ id: string; name: string; content: string; timestamp: number }`

- **saveDesign(name: string, content: string)**: 保存设计
  - 返回: `{ id: string; name: string; content: string; timestamp: number }`

## Renderer 侧调用示例

```typescript
import { RPCProxyClient } from '@x-oasis/async-call-rpc'

const designService = new RPCProxyClient<DesignService>({
  channel: messagePort,
  remotePath: '/design-service',
})

// 验证通信
const result = await designService.ping({ ts: Date.now() })
console.log('Design service ping result:', result)

// 保存设计
const design = await designService.saveDesign('My Design', '{ /* design data */ }')
console.log('Design saved:', design)
```

## 日志

应用启动日志输出到 `/tmp/design-process.log`
