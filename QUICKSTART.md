# Quick Start: Chat & Design Applications

快速开始指南，几分钟内验证 RPC 通信是否正常。

## 第一步: 构建应用

```bash
# 从项目根目录
pnpm --filter chat build
pnpm --filter design build
pnpm --filter telegraph build
```

或逐个构建:
```bash
cd apps/chat && pnpm build && cd ../..
cd apps/design && pnpm build && cd ../..
cd apps/telegraph && pnpm build && cd ../..
```

## 第二步: 启动 Telegraph 应用

```bash
cd apps/telegraph
pnpm start
```

这将启动 Electron app，自动创建 Chat 和 Design 的进程。

## 第三步: 验证进程启动

打开新的终端窗口，检查日志:

```bash
# 检查 Chat 进程日志
tail -f /tmp/chat-process.log

# 在另一个终端检查 Design 进程日志
tail -f /tmp/design-process.log

# 在另一个终端检查 Telegraph main 进程日志
tail -f /tmp/telegraph-main.log
```

您应该看到类似的输出：
```
[2024-05-06T...] main.ts entry; pid=12345
[2024-05-06T...] imports ok; building DI container
[2024-05-06T...] container loaded; resolving ChatApplication
[2024-05-06T...] ChatApplication resolved; calling start()
[2024-05-06T...] [ChatApplication] starting...
[2024-05-06T...] [ChatApplication] started successfully
[2024-05-06T...] start() returned; keeping process alive
```

## 第四步: 在 Renderer 中测试

在 Telegraph 应用窗口中打开开发者工具 (F12 或 Cmd+I)，在控制台中执行:

```javascript
// 获取 Chat 服务客户端（需要根据您的集成方式调整）
// 假设您已有 chatService 的引用
const result = await chatService.ping({ ts: Date.now() })
console.log('✅ Chat service responded:', result)

// 尝试发送消息
const msg = await chatService.sendMessage('Hello from renderer!')
console.log('✅ Message sent:', msg)
```

## 第五步: 验证往返时间

在控制台中执行：

```javascript
const startTime = Date.now()
const result = await chatService.ping({ ts: startTime })
const roundTripTime = Date.now() - startTime

console.log('Round trip time:', roundTripTime, 'ms')
console.log('Renderer → Process time:', result.receivedTs - startTime, 'ms')
console.log('Process → Renderer time:', Date.now() - result.ts, 'ms')
```

## 预期结果

✅ Chat 和 Design 进程成功启动
✅ Renderer 能调用 ping() 并获得响应
✅ 往返时间应该在 10-50ms 之间
✅ 日志显示"start() returned; keeping process alive"

## 常见问题

### Q: 没看到进程日志
**A**: 
- 检查 `/tmp/chat-process.log` 和 `/tmp/design-process.log` 文件是否存在
- 如果不存在，说明进程未启动。检查 `warmupInlinePageletProcesses` 是否被调用
- 查看 `/tmp/telegraph-main.log` 中的错误信息

### Q: RPC 调用超时
**A**: 
- 确认进程已启动（查看日志）
- 检查 MessagePort 是否正确传递到 Renderer
- 验证 RPC 路径是否正确 (`/chat-service` 或 `/design-service`)

### Q: 收不到响应
**A**: 
- 检查进程是否崩溃，查看 `/tmp/*-process.log`
- 验证序列化的返回值（避免返回函数、Symbol 等不可序列化的值）
- 检查网络/IPC 连接是否正常

## 下一步

- 阅读 [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md) 了解详细的集成方案
- 查看 [apps/chat/README.md](./apps/chat/README.md) 和 [apps/design/README.md](./apps/design/README.md) 了解应用结构
- 在您的 Renderer 组件中实现上述服务调用

## 性能参考

| 操作 | 期望延迟 |
|------|---------|
| ping() | 10-50ms |
| getMessage() | 5-20ms |
| sendMessage() | 5-20ms |

如果延迟明显偏高，可能是：
- CPU/内存压力大
- 消息体过大
- 网络 I/O 阻塞
