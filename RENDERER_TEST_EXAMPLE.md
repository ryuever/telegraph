# Renderer 侧 RPC 测试示例

本文档提供了在 Telegraph Renderer 中测试 Chat 和 Design 应用 RPC 通信的完整示例代码。

## 前置条件

- Telegraph 应用已启动
- Chat 和 Design 进程已创建
- Renderer 已建立 MessagePort 连接

## 示例 1: 简单的 Ping 测试

在浏览器开发者工具控制台中执行：

```javascript
// 假设您已有 chatService 和 designService 的 RPC 客户端引用
// 这取决于您的具体集成方式

async function testPing() {
  try {
    console.log('📡 Testing Chat service ping...')
    const chatResult = await chatService.ping({ ts: Date.now() })
    console.log('✅ Chat service responded:', chatResult)
    
    console.log('📡 Testing Design service ping...')
    const designResult = await designService.ping({ ts: Date.now() })
    console.log('✅ Design service responded:', designResult)
  } catch (error) {
    console.error('❌ Ping failed:', error)
  }
}

testPing()
```

## 示例 2: 完整的服务测试套件

创建一个 React 组件用于测试：

```typescript
import { useState, useEffect } from 'react'
import { RPCProxyClient } from '@x-oasis/async-call-rpc-web'

interface PingResult {
  pong: true
  processId: string
  projectName: string
  ts: number
  receivedTs?: number
}

interface Message {
  id: string
  text: string
  timestamp: number
}

interface ServiceTest {
  name: string
  status: 'idle' | 'testing' | 'success' | 'error'
  result?: any
  error?: string
  duration?: number
}

export function RpcTestPanel({ chatService, designService }) {
  const [tests, setTests] = useState<ServiceTest[]>([
    { name: 'Chat Ping', status: 'idle' },
    { name: 'Chat Send Message', status: 'idle' },
    { name: 'Chat Get Message', status: 'idle' },
    { name: 'Design Ping', status: 'idle' },
    { name: 'Design Get Design', status: 'idle' },
    { name: 'Design Save Design', status: 'idle' },
  ])

  const updateTest = (index: number, update: Partial<ServiceTest>) => {
    setTests((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], ...update }
      return next
    })
  }

  const testChatPing = async (index: number) => {
    updateTest(index, { status: 'testing' })
    const startTime = Date.now()
    try {
      const result = await chatService.ping({ ts: startTime })
      const duration = Date.now() - startTime
      updateTest(index, {
        status: 'success',
        result,
        duration,
      })
    } catch (error) {
      updateTest(index, {
        status: 'error',
        error: (error as Error).message,
      })
    }
  }

  const testChatSendMessage = async (index: number) => {
    updateTest(index, { status: 'testing' })
    const startTime = Date.now()
    try {
      const result = await chatService.sendMessage('Test message from renderer')
      const duration = Date.now() - startTime
      updateTest(index, {
        status: 'success',
        result,
        duration,
      })
    } catch (error) {
      updateTest(index, {
        status: 'error',
        error: (error as Error).message,
      })
    }
  }

  const testChatGetMessage = async (index: number) => {
    updateTest(index, { status: 'testing' })
    const startTime = Date.now()
    try {
      const result = await chatService.getMessage('msg-123')
      const duration = Date.now() - startTime
      updateTest(index, {
        status: 'success',
        result,
        duration,
      })
    } catch (error) {
      updateTest(index, {
        status: 'error',
        error: (error as Error).message,
      })
    }
  }

  const testDesignPing = async (index: number) => {
    updateTest(index, { status: 'testing' })
    const startTime = Date.now()
    try {
      const result = await designService.ping({ ts: startTime })
      const duration = Date.now() - startTime
      updateTest(index, {
        status: 'success',
        result,
        duration,
      })
    } catch (error) {
      updateTest(index, {
        status: 'error',
        error: (error as Error).message,
      })
    }
  }

  const testDesignGetDesign = async (index: number) => {
    updateTest(index, { status: 'testing' })
    const startTime = Date.now()
    try {
      const result = await designService.getDesign('design-456')
      const duration = Date.now() - startTime
      updateTest(index, {
        status: 'success',
        result,
        duration,
      })
    } catch (error) {
      updateTest(index, {
        status: 'error',
        error: (error as Error).message,
      })
    }
  }

  const testDesignSaveDesign = async (index: number) => {
    updateTest(index, { status: 'testing' })
    const startTime = Date.now()
    try {
      const result = await designService.saveDesign('Test Design', '{ "color": "red" }')
      const duration = Date.now() - startTime
      updateTest(index, {
        status: 'success',
        result,
        duration,
      })
    } catch (error) {
      updateTest(index, {
        status: 'error',
        error: (error as Error).message,
      })
    }
  }

  const testHandlers = [
    () => testChatPing(0),
    () => testChatSendMessage(1),
    () => testChatGetMessage(2),
    () => testDesignPing(3),
    () => testDesignGetDesign(4),
    () => testDesignSaveDesign(5),
  ]

  const runAllTests = async () => {
    setTests((prev) => prev.map((t) => ({ ...t, status: 'idle' })))
    for (let i = 0; i < testHandlers.length; i++) {
      await testHandlers[i]()
      // 避免同时发送所有请求
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  const passedTests = tests.filter((t) => t.status === 'success').length
  const failedTests = tests.filter((t) => t.status === 'error').length

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h2>RPC 通信测试面板</h2>

      <div style={{ marginBottom: '20px' }}>
        <button onClick={runAllTests} style={{ padding: '10px 20px', cursor: 'pointer' }}>
          运行所有测试
        </button>
        <span style={{ marginLeft: '20px' }}>
          通过: <span style={{ color: 'green' }}>{passedTests}</span> | 失败:{' '}
          <span style={{ color: 'red' }}>{failedTests}</span>
        </span>
      </div>

      <div style={{ border: '1px solid #ccc', padding: '10px', maxHeight: '500px', overflowY: 'auto' }}>
        {tests.map((test, index) => (
          <div
            key={index}
            style={{
              padding: '10px',
              marginBottom: '10px',
              border: '1px solid #ddd',
              borderLeft: `4px solid ${
                test.status === 'success'
                  ? 'green'
                  : test.status === 'error'
                    ? 'red'
                    : test.status === 'testing'
                      ? 'blue'
                      : 'gray'
              }`,
            }}
          >
            <div style={{ marginBottom: '8px' }}>
              <button
                onClick={() => testHandlers[index]()}
                disabled={test.status === 'testing'}
                style={{ marginRight: '10px', cursor: 'pointer' }}
              >
                {test.status === 'testing' ? '运行中...' : '运行'}
              </button>
              <strong>{test.name}</strong>
              <span style={{ marginLeft: '10px', color: 'gray' }}>
                {test.status === 'success' ? `✅ ${test.duration}ms` : test.status === 'error' ? `❌ ${test.error}` : ''}
              </span>
            </div>

            {test.result && (
              <pre
                style={{
                  backgroundColor: '#f5f5f5',
                  padding: '8px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  overflow: 'auto',
                  maxHeight: '200px',
                }}
              >
                {JSON.stringify(test.result, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

## 示例 3: 性能测试

```typescript
async function performanceTest() {
  const iterations = 100
  const results = []

  console.log(`🔄 Running ${iterations} iterations...`)

  for (let i = 0; i < iterations; i++) {
    const startTime = performance.now()
    try {
      await chatService.ping({ ts: Date.now() })
      const duration = performance.now() - startTime
      results.push(duration)
    } catch (error) {
      console.error(`Iteration ${i} failed:`, error)
    }
  }

  const avg = results.reduce((a, b) => a + b, 0) / results.length
  const min = Math.min(...results)
  const max = Math.max(...results)
  const p95 = results.sort((a, b) => a - b)[Math.floor(results.length * 0.95)]

  console.log('📊 Performance Results:')
  console.table({
    'Min (ms)': min.toFixed(2),
    'Max (ms)': max.toFixed(2),
    'Avg (ms)': avg.toFixed(2),
    'P95 (ms)': p95.toFixed(2),
  })
}

performanceTest()
```

## 示例 4: 并发测试

```typescript
async function concurrencyTest() {
  console.log('🚀 Running concurrency test...')

  const promises = Array.from({ length: 50 }, (_, i) =>
    chatService.sendMessage(`Message ${i}`).catch((err) => {
      console.error(`Message ${i} failed:`, err)
    })
  )

  const startTime = Date.now()
  await Promise.all(promises)
  const duration = Date.now() - startTime

  console.log(`✅ 50 concurrent messages sent in ${duration}ms`)
  console.log(`Average: ${(duration / 50).toFixed(2)}ms per message`)
}

concurrencyTest()
```

## 示例 5: 错误处理测试

```typescript
async function errorHandlingTest() {
  console.log('🧪 Testing error handling...')

  // 测试 1: 无效的消息 ID
  try {
    await chatService.getMessage('')
    console.log('❌ Should have failed with empty ID')
  } catch (error) {
    console.log('✅ Correctly failed with empty ID:', (error as Error).message)
  }

  // 测试 2: 超时模拟（取决于实现）
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
  const promise = chatService.getMessage('test-id')
  try {
    await Promise.race([promise, timeout])
  } catch (error) {
    console.log('✅ Timeout handling works:', (error as Error).message)
  }
}

errorHandlingTest()
```

## 集成到 React 组件

```typescript
import { useEffect, useState } from 'react'

export function ChatPanel() {
  const [chatService, setChatService] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')

  useEffect(() => {
    // 初始化 RPC 客户端
    const initService = async () => {
      try {
        // 这取决于您的 PageletClientChannel 实现
        const chatService = await initializeChatService()
        setChatService(chatService)

        // 验证连接
        const result = await chatService.ping({ ts: Date.now() })
        console.log('Connected to chat service:', result)
        setIsConnected(true)
      } catch (error) {
        console.error('Failed to initialize chat service:', error)
      }
    }

    initService()
  }, [])

  const handleSendMessage = async () => {
    if (!chatService || !inputValue.trim()) return

    try {
      const msg = await chatService.sendMessage(inputValue)
      setMessages((prev) => [...prev, msg])
      setInputValue('')
    } catch (error) {
      console.error('Failed to send message:', error)
    }
  }

  return (
    <div>
      <h3>Chat Panel {isConnected ? '✅' : '❌'}</h3>

      <div style={{ border: '1px solid #ccc', padding: '10px', minHeight: '200px', marginBottom: '10px' }}>
        {messages.map((msg) => (
          <div key={msg.id} style={{ marginBottom: '10px', padding: '10px', backgroundColor: '#f5f5f5' }}>
            <small style={{ color: 'gray' }}>{new Date(msg.timestamp).toLocaleTimeString()}</small>
            <p>{msg.text}</p>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '10px' }}>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
          placeholder="Enter message..."
          style={{ flex: 1, padding: '8px' }}
        />
        <button onClick={handleSendMessage} disabled={!isConnected || !inputValue.trim()}>
          Send
        </button>
      </div>
    </div>
  )
}
```

## 调试提示

1. **检查 MessagePort 连接**:
   ```javascript
   console.log('messagePort:', messagePort)
   console.log('messagePort.onmessage:', messagePort.onmessage)
   ```

2. **验证 RPC 路径**:
   ```javascript
   // 应该看到注册的处理器
   console.log('Remote path:', '/chat-service')
   ```

3. **跟踪 RPC 调用**:
   ```javascript
   const origSend = console.log
   const traces = []
   chatService.on?.('send', (msg) => {
     traces.push({ type: 'send', msg, time: Date.now() })
   })
   chatService.on?.('receive', (msg) => {
     traces.push({ type: 'receive', msg, time: Date.now() })
   })
   ```

4. **检查进程状态**:
   ```javascript
   // 在终端中
   ps aux | grep 'chat\|design'
   tail -f /tmp/chat-process.log
   ```
