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
- shared process: 是共享进行，它主要是提供一些公共的基础能力，比如AppInfoService，LoginService等；它是随着主app的启动而创建，默认情况下，当一个 Pagelet Process 创建以后，都会被分配一个 SharedProcess Port，这样可以实现
- daemon process: 守护进程，它也是随着主app创建的，比如MonitorService，DumpService等涉及到稳定性和性能的任务都在这里，它跟SharedProcess都是全局只有一个，但是默认情况daemon process不需要跟 Pagelet Process 创建的时候建联；它里面有个核心功能实时监控每一个pagelet process以及shared process的资源消耗，如果有一个超过阈值了，那么就kills掉；这个就会涉及到被kill掉的process怎么跟已经建联的renderer或者process重新建联的问题（重点关注下）；
- pagelet process：当创建一个tab应用的时候，比如chat，design 等，都是默认会创建一个 PageletProcess，在目前的架构下，tab 应用都是跟main 共享renderer的，现在创建 Pagelet Process作为一个独立的process一方面确保tab 应用的隔离，另一方面确保稳定性放置一个app比如跑挂了，造成整体主app卡死等问题；在默认情况下，Pagelet Process 是跟tab app默认通过port建联的，同时如果说