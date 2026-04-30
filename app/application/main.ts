const { app, BrowserWindow } = require('electron')
const path = require('path')

let mainWindow

console.error('========== MAIN PROCESS STARTED ==========')

function createWindow() {
  console.error('Creating window...')

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: false,
      // preload: path.join(__dirname, 'preload.js'),
    },
  })

  mainWindow.once('ready-to-show', () => {
    console.error('✅ Window ready to show - displaying window')
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    console.error('Window closed')
    mainWindow = null
  })

  console.error('Loading http://localhost:5173...')
  mainWindow.loadURL('http://localhost:5173')
    .then(() => console.error('✅ URL loaded'))
    .catch((error) => {
      console.error('Failed to load dev server, trying file...', error)
      mainWindow.loadFile('index.html')
        .then(() => console.error('✅ File loaded'))
        .catch((err) => console.error('Failed to load file:', err))
    })

  mainWindow.webContents.openDevTools()
}

console.error('Setting up app event listeners...')

app.on('ready', () => {
  console.error('App ready event')
  createWindow()
})

app.on('window-all-closed', () => {
  console.error('All windows closed')
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  console.error('App activated')
  if (mainWindow === null) {
    createWindow()
  }
})

console.error('========== MAIN PROCESS SETUP COMPLETE ==========')
