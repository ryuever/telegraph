import type { IpcRendererEvent } from 'electron'
import { ipcRenderer, webFrame, contextBridge } from 'electron'
// import { IPCRendererChannel } from '@x-oasis/async-call-rpc-electron'

const listenerWrappers = new Map<
  string,
  WeakMap<
    (event: IpcRendererEvent, ...args: any[]) => void,
    (event: IpcRendererEvent, ...args: any[]) => void
  >
>()

function getListenerWrapperMap(channel: string) {
  let wrappers = listenerWrappers.get(channel)
  if (!wrappers) {
    wrappers = new WeakMap()
    listenerWrappers.set(channel, wrappers)
  }
  return wrappers
}

// const url = new URL(window.location.href)
// const { pathname } = url
// const reg = /^\/?(\w+)([/?#].*)?$/

// const matched = pathname.match(reg)

// if (matched) {
//   const platform = matched[1]
//   const portReceiver = () => (value: any) => {
//     const data = value.data
//     const body = data[1]
//     const args = body[0]

//     const peerName = args.peerName

//     window.postMessage(`${peerName}-port`, '*', value.ports)

//     return value
//   }

//   new IPCRendererChannel({
//     channelName: `${platform}-pagelet-port`,
//     projectName: `${platform}`,
//     masterProcessName: `${platform}-renderer`,
//     ipcRenderer,
//     receiverMiddlewares: [portReceiver],
//   })
// }

function validateIPC(channel: string) {
  return true
  // if (!channel || !channel.startsWith('telegraph:')) {
  //   throw new Error(`Unsupported event IPC channel '${channel}'`);
  // }

  // return true;
}

const globals = {
  ipcRenderer: {
    send(channel: string, ...args: any[]) {
      if (validateIPC(channel)) {
        ipcRenderer.send(channel, ...args)
      }
    },

    invoke(channel: string, ...args: any[]) {
      validateIPC(channel)
      return ipcRenderer.invoke(channel, ...args)
    },

    on(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void) {
      validateIPC(channel)

      const wrapper = (...args: [IpcRendererEvent, ...any[]]) => {
        const ports = args[0].ports
        if (ports.length) {
          window.postMessage(
            {
              channel,
              data: args[1],
            },
            '*',
            ports
          )
        } else {
          listener(...args)
        }
      }

      getListenerWrapperMap(channel).set(listener, wrapper)
      ipcRenderer.on(channel, wrapper)
      return this
    },

    once(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void) {
      validateIPC(channel)

      ipcRenderer.once(channel, listener)

      return this
    },

    removeListener(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void) {
      validateIPC(channel)

      const wrappers = getListenerWrapperMap(channel)
      const wrapper = wrappers.get(listener) ?? listener
      ipcRenderer.removeListener(channel, wrapper)
      wrappers.delete(listener)

      return this
    },
  },

  ipcMessagePort: {
    // /**
    //  * @param {string} responseChannel
    //  * @param {string} nonce
    //  */
    // acquire(responseChannel: string, nonce: string) {
    //   if (validateIPC(responseChannel)) {
    //     const responseListener = (e: MessageEvent, responseNonce: string) => {
    //       if (nonce === responseNonce) {
    //         ipcRenderer.off(responseChannel, responseListener)
    //         window.postMessage(nonce, '*', e.ports)
    //       }
    //     }
    //     ipcRenderer.on(responseChannel, responseListener)
    //   }
    // },
  },

  webFrame: {
    setZoomLevel(level: number) {
      if (typeof level === 'number') {
        webFrame.setZoomLevel(level)
      }
    },
  },
}

// Use `contextBridge` APIs to expose globals to VSCode
// only if context isolation is enabled, otherwise just
// add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('telegraph', globals)
  } catch (error) {
    console.error(error)
  }
} else {
  window.telegraph = globals
}
