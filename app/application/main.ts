const electron = require('electron')
const { app, BrowserWindow } = electron

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.loadURL('http://localhost:5173')
    .catch((error) => {
      console.error('Failed to load dev server:', error)
      mainWindow.loadFile('index.html')
        .catch((err) => console.error('Failed to load file:', err))
    })

  mainWindow.webContents.openDevTools()
}

// Set up event listeners first
app.on('ready', () => {
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

// Handle case where app might already be ready
process.nextTick(() => {
  if (app.isReady() && mainWindow === null) {
    createWindow()
  }
})
