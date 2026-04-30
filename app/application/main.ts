import { app, BrowserWindow } from 'electron'

// Simple development version - just create a window and load the renderer
let mainWindow: BrowserWindow

console.log('Main process started!')

function createWindow() {
  console.log('Creating window...')
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // preload will be injected by forge
    },
  })

  console.log('Window created, loading URL...')

  // In development, load from vite dev server
  // In production, load from bundled HTML
  const loadURL = async () => {
    try {
      console.log('Attempting to load http://localhost:5173')
      await mainWindow.loadURL('http://localhost:5173')
      console.log('URL loaded successfully')
    } catch (error) {
      console.log('Failed to load dev server, trying file:', error)
      try {
        await mainWindow.loadFile('index.html')
        console.log('File loaded successfully')
      } catch (fileError) {
        console.error('Failed to load file:', fileError)
      }
    }
  }

  loadURL()

  mainWindow.webContents.openDevTools()

  mainWindow.once('ready-to-show', () => {
    console.log('Window ready to show')
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    console.log('Window closed')
    mainWindow = null as any
  })

  mainWindow.webContents.on('crashed', () => {
    console.log('Renderer process crashed!')
  })
}

// Use whenReady() to handle both synchronous and asynchronous app ready states
app.whenReady().then(() => {
  console.log('App ready event')
  createWindow()
}).catch((error) => {
  console.error('Error when app ready:', error)
})

app.on('window-all-closed', () => {
  console.log('All windows closed')
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  console.log('App activated')
  if (!mainWindow) {
    createWindow()
  }
})

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error)
})
