// EMS desktop shell. Serves the built web app from a small local web server and
// shows it in app windows. Mock mode needs a real http origin: MSW runs in a
// service worker, which doesn't work on file:// pages.
const { app, BrowserWindow, Menu, dialog, session, shell } = require('electron')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const WEB_ROOT = path.join(__dirname, '..', 'dist-desktop')
// A fixed port keeps the same origin between launches, so demo data, the
// field PIN and settings saved in the browser storage survive a restart.
const PREFERRED_PORT = 47821
const PAPER = '#F6F4EE'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

let origin = ''
let mainWindow = null
let fieldWindow = null

function serve(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const requested = path.normalize(path.join(WEB_ROOT, decodeURIComponent(url.pathname)))
  if (!requested.startsWith(WEB_ROOT)) {
    res.writeHead(403).end()
    return
  }
  let file = requested
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // Client-side routes (/customers/…, /field/today) get the app shell.
    if (path.extname(url.pathname)) {
      res.writeHead(404).end()
      return
    }
    file = path.join(WEB_ROOT, 'index.html')
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  })
  fs.createReadStream(file).pipe(res)
}

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(serve)
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server.address().port))
  })
}

async function startServer() {
  try {
    return await listen(PREFERRED_PORT)
  } catch {
    // Something else holds the port. Run anyway; saved demo data won't carry over.
    return listen(0)
  }
}

function keepLinksInApp(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin)) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
}

function createWindow({ route, width, height, minWidth, minHeight, title }) {
  const win = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    title,
    backgroundColor: PAPER,
    show: false,
    icon: path.join(WEB_ROOT, 'pwa-192x192.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  keepLinksInApp(win)
  win.once('ready-to-show', () => win.show())
  void win.loadURL(origin + route)
  return win
}

function openBackOffice() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus()
    return
  }
  mainWindow = createWindow({
    route: '/',
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 640,
    title: 'EMS',
  })
  mainWindow.maximize()
}

/** The officer app at phone size, as it looks on an Android phone. */
function openFieldApp() {
  if (fieldWindow && !fieldWindow.isDestroyed()) {
    fieldWindow.focus()
    return
  }
  fieldWindow = createWindow({
    route: '/field/today',
    width: 412,
    height: 860,
    minWidth: 360,
    minHeight: 600,
    title: 'EMS Field',
  })
}

async function resetDemoData() {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Reset and restart', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Reset demo data',
    message: 'Start again with fresh demo data?',
    detail:
      'Everything you have added or changed is removed: customers, collections, approvals, field PINs and sign-ins. EMS restarts afterwards.',
  })
  if (response !== 0) return
  await session.defaultSession.clearStorageData()
  app.relaunch()
  app.exit(0)
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Back office', accelerator: 'CmdOrCtrl+1', click: openBackOffice },
        { label: 'Field app (phone size)', accelerator: 'CmdOrCtrl+2', click: openFieldApp },
        { type: 'separator' },
        { label: 'Reset demo data…', click: () => void resetDemoData() },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools', label: 'Developer tools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About EMS',
          click: () =>
            dialog.showMessageBox({
              title: 'About EMS',
              message: `Entacrest MFB Solution (EMS) ${app.getVersion()}`,
              detail:
                'An Entacrest Nexus product.\n\nThis test build runs on demo data kept on this computer. Every account uses the password Demo@2026 and the sign-in code 123456.',
            }),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

if (!app.requestSingleInstanceLock()) {
  // A second copy would fight over the port and the demo data.
  app.quit()
} else {
  app.on('second-instance', openBackOffice)
  app.setAppUserModelId('ng.entacrest.ems')

  void app.whenReady().then(async () => {
    const port = await startServer()
    origin = `http://127.0.0.1:${port}`
    buildMenu()
    openBackOffice()
  })

  app.on('window-all-closed', () => app.quit())
}
