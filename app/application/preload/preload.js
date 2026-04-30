(function () {
  const { ipcRenderer, webFrame, contextBridge } = require('electron')

  /**
   * @param {string} channel
   * @returns {true | never}
   */
  function validateIPC(channel) {
    return true
    // if (!channel || !channel.startsWith('redcity:')) {
    //   throw new Error(`Unsupported event IPC channel '${channel}'`);
    // }

    // return true;
  }

  const globals = {
    ipcRenderer: {
      send(channel, ...args) {
        if (validateIPC(channel)) {
          ipcRenderer.send(channel, ...args);
        }
      },

      invoke(channel, ...args) {
        validateIPC(channel);
        return ipcRenderer.invoke(channel, ...args);
      },

      on(channel, listener) {
        validateIPC(channel);

        ipcRenderer.on(channel, listener);
        return this;
      },

      once(channel, listener) {
        validateIPC(channel);

        ipcRenderer.once(channel, listener);

        return this;
      },

      removeListener(channel, listener) {
        validateIPC(channel);

        ipcRenderer.removeListener(channel, listener);

        return this;
      }
    },

    ipcMessagePort: {

      /**
       * @param {string} responseChannel
       * @param {string} nonce
       */
      acquire(responseChannel, nonce) {
        if (validateIPC(responseChannel)) {
          const responseListener = (e, responseNonce) => {
            if (nonce === responseNonce) {
              ipcRenderer.off(responseChannel, responseListener);
              window.postMessage(nonce, '*', e.ports);
            }
          };
          ipcRenderer.on(responseChannel, responseListener);
        }
      }
    },

    webFrame: {
      setZoomLevel(level) {
        if (typeof level === 'number') {
          webFrame.setZoomLevel(level);
        }
      }
    },
  };

  // Use `contextBridge` APIs to expose globals to VSCode
  // only if context isolation is enabled, otherwise just
  // add to the DOM global.
  if (process.contextIsolated) {
    try {
      contextBridge.exposeInMainWorld('redcity', globals);
    } catch (error) {
      console.error(error);
    }
  } else {
    window.redcity = globals;
  }
}());
