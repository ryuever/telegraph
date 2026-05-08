# Refactor port management

## Structure
首先是对整个项目进行一个功能划分

```bash
➜  telegraph git:(feat-multiple) ✗ tree -d -L 1 apps/
apps/
├── chat
├── design
├── monitor
└── telegraph
```

### Renderer

- telegraph：是跑在 main process它对应了一个 BrowserWindow Renderer
- chat：它是跟 telegraph 同一个renderer，可以认为多路由页面的子page
- design：它是跟 telegraph 同一个renderer，可以认为多路由页面的子page
- monitor：它是单独开了一个 BrowserView 进行渲染

### pagelet

#### 现状

以 chat 为例

```ts
// apps/telegraph/src/services/window-manager/electron-main/BrowserWindow.ts
  /**
   * inline panel 的 amdEntry 映射。
   * 构建产物命名规则：{projectName}-pagelet-entry.js
   */
  private static INLINE_AMD_ENTRIES: Record<string, string> = {
    chat: 'chat-pagelet-entry.js',
    design: 'design-pagelet-entry.js',
  }
```

```ts
// apps/telegraph/forge.config.ts
{
  entry: 'src/services/process/pagelet-process/node/chat-pagelet-entry.ts',
  config: 'vite.fork.config.ts',
},
```

```ts
// apps/telegraph/src/services/process/pagelet-process/node/chat-pagelet-entry.ts
/**
 * chat 进程的 amdEntry wrapper。
 * pagelet-process-bootstrap 通过 TELEGRAPH_AMD_ENTRY 加载此文件，
 * 此文件 re-export chat app 的 initApplication。
 */
export { default } from '@chat/main'
```

其实也就是对应了 `@chat/main`；目前它对应的位置其实在 `apps/chat/src/main.ts`；

#### 预期

首先优化下 `apps/chat`下的结构，

- 对外暴露application文件夹，它里面要按照标准node, electron-main, browser等结构化语义进行划分
- chat最终是要跑在 utility process的，它是一个node process，所以它涉及到的后端要放到 node 下
- 对于ui层，主框架还是放到 application/browser 里面；它现在是被放到. packages/ui/src/components/src 中，这个目前最好还是拆一下；

## Pagelet, Shared, Daemon, Main Process

前面说的是基础的代码结构，接下来说的是数据流转，process 串联；首先描述一下不同process的作用
- main process：这个就是 electron 的主进程，它承担了所有的进程spawn，默认创建两个独立进程 shared, daemon process；假如说有新的app创建的时候，默认情况下 renderer层面是用的同一个，但是每一个app启动的时候都会创建一个 pagelet process, renderer只跟 pagelet通信
- shared process: 是共享进行，它主要是提供一些公共的基础能力，比如AppInfoService，LoginService等；它是随着主app的启动而创建，默认情况下，当一个 Pagelet Process 创建以后，都会被分配一个 SharedProcess Port，这样可以实现；它需要有个能力就是如果因为资源消耗过多，被daemon process kill掉，能够重启并且自动建联已经连接的renderer 或 utility process
- daemon process: 守护进程，它也是随着主app创建的，比如MonitorService，DumpService等涉及到稳定性和性能的任务都在这里，它跟SharedProcess都是全局只有一个，但是默认情况daemon process不需要跟 Pagelet Process 创建的时候建联；它里面有个核心功能实时监控每一个pagelet process以及shared process的资源消耗，如果有一个超过阈值了，那么就kills掉；这个就会涉及到被kill掉的process怎么跟已经建联的renderer或者process重新建联的问题（重点关注下）；
- pagelet process：当创建一个tab应用的时候，比如chat，design 等，都是默认会创建一个 PageletProcess，在目前的架构下，tab 应用都是跟main 共享renderer的，现在创建 Pagelet Process作为一个独立的process一方面确保tab 应用的隔离，另一方面确保稳定性放置一个app比如跑挂了，造成整体主app卡死等问题；在默认情况下，Pagelet Process 是跟tab app默认通过port建联的，需要注意的是 tab app 只跟 pagelet process进行打交道！！！；最后它需要有个能力就是如果因为资源消耗过多，被daemon process kill掉，能够重启并且自动建联已经连接的renderer 或 utility process

## RPC 调用

！！！ important

在整个项目中，不能够直接使用 ipcMain, ipcRenderer，webContents等这些基础api进行通信，他们都需要被分装成 @x-oasis/async-call-rpc-electron 中对应的protocol，然后通过 RPC client进行调用；


### 如何改造

现在对于 shared process, daemon process, pagelet process 的维护以及port的管理主要是在 /Users/ryu/Documents/code/modules/ai/telegraph/apps/telegraph/src/services 中的 port-manager, process文件夹；但是现在的port 建联方式过于繁琐，这个具体可以看下 /Users/ryu/Documents/code/red/x-oasis/ASYNC_CALL_RPC_CONNECTION_ORCHESTRATOR.md 中有参数，为了解决概念过多的问题，我其实将 @x-oasis/aysnc-call-rpc, @x-oasis/aysnc-call-rpc-electron 等增加 connection orchestrator 概念；具体如何高效的创建 renderer 和 utility process, utility process 之间的port建联，可以参考 /Users/ryu/Documents/code/red/x-oasis/packages/async/async-call-rpc-electron/docs/scenario-orchestration.md;

## 验证方式

- 改造开始首先将 "@x-oasis/async-call-rpc","@x-oasis/async-call-rpc-electron", "@x-oasis/async-call-rpc-node", "@x-oasis/async-call-rpc-web" 通过pnpm 升级成最新的。
- 整个port的改造目前主要是集中在更合理的拆分tab app中的模块划分
- 优化旧框架下的 shared, daemon, pagelet process的创建和建联，全面替换最新版本 @x-oasis/async-call-rpc-*，因为里面有我最新实现的 connection orchestrator 实现引入。
- 目前的改造可以先只做 apps/design 的适配，等整个流程跑通了，然后再推广
- 对于apps/design 的验收，你需要帮我提供一个可视化的入口，点击完以后可以展示当前 design panel 到底连接了什么 process（这个process要下撰的，要同时显示这个process到底跟那些process 有建联）,最后你要有实例验证render跟process通信是好的。