# Chat Application

一个简单的 Node.js 进程应用，通过 RPC 暴露 Chat 服务。

## 目录结构

```
chat/
├── src/
│   ├── application/
│   │   ├── chat-application.ts       # Chat 应用主类，实现 ChatService 接口
│   │   └── chat-application-module.ts # DI 容器配置
│   └── main.ts                        # 应用入口，初始化和启动应用
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 如何构建

```bash
cd apps/chat
pnpm build
```

构建产物将输出到 `.vite/build/index.js`

## 如何运行

```bash
node .vite/build/index.js
```

或通过 electron UtilityProcess 运行（由 telegraph 应用管理）

## 暴露的服务

### ChatService (RPC path: `/chat-service`)

- **ping(payload?)**: 验证通信是否正常
  - 返回: `{ pong: true; processId: string; projectName: 'chat'; ts: number; receivedTs?: number }`

- **getMessage(id: string)**: 获取消息
  - 返回: `{ id: string; text: string; timestamp: number }`

- **sendMessage(text: string)**: 发送消息
  - 返回: `{ id: string; text: string; timestamp: number }`

## Renderer 侧调用示例

```typescript
import { RPCProxyClient } from '@x-oasis/async-call-rpc'

const chatService = new RPCProxyClient<ChatService>({
  channel: messagePort,
  remotePath: '/chat-service',
})

// 验证通信
const result = await chatService.ping({ ts: Date.now() })
console.log('Chat service ping result:', result)

// 发送消息
const msg = await chatService.sendMessage('Hello from renderer')
console.log('Message sent:', msg)
```

## 日志

应用启动日志输出到 `/tmp/chat-process.log`
