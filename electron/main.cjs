// EMS desktop app.
//
// Two workspaces run side by side, each its own EMS server process
// (build/server/main.cjs) on its own local address, so their data, sign-ins and
// field-app storage never mix:
//   live  127.0.0.1:47821  this computer's SQLite, a Supabase/PostgreSQL
//                          database, or (remote) the organisation's web server
//   demo  127.0.0.1:47822  sample data for training, started when first opened
// The licence is shared through a file in the data folder.
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  dialog,
  ipcMain,
  safeStorage,
  session,
  shell,
  utilityProcess,
} = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const APP_ROOT = path.join(__dirname, '..')
const SERVER_MAIN = path.join(APP_ROOT, 'build', 'server', 'main.cjs')
const SERVER_LIB = path.join(APP_ROOT, 'build', 'server', 'ems.cjs')
const WEB_ROOT = path.join(APP_ROOT, 'dist-desktop')
const ICON = path.join(WEB_ROOT, 'pwa-192x192.png')
const PAPER = '#F6F4EE'

// A separate profile (data, licence, sign-ins), e.g. to test beside an installed copy.
if (process.env.EMS_USER_DATA) app.setPath('userData', process.env.EMS_USER_DATA)

const dataDir = () => path.join(app.getPath('userData'), 'data')
const configFile = () => path.join(app.getPath('userData'), 'config.json')

// ── Connection settings ─────────────────────────────────────────────────────
// {
//   live: { kind: 'sqlite' } | { kind: 'postgres', url, schema } | { kind: 'remote', url },
//   share: true when other computers on the office network may connect to this one
// }
// Database passwords are encrypted with Windows' data protection (safeStorage).

function readRawConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8'))
  } catch {
    return {}
  }
}

function readConfig() {
  const raw = readRawConfig()
  const live = raw.live ?? { kind: 'sqlite' }
  try {
    if (live.kind === 'postgres' && live.urlEncrypted)
      live.url = safeStorage.decryptString(Buffer.from(live.urlEncrypted, 'base64'))
  } catch {
    return { live: { kind: 'sqlite' }, share: false }
  }
  return { live, share: Boolean(raw.share) }
}

function writeConfig(config) {
  const live = { ...config.live }
  if (live.kind === 'postgres' && safeStorage.isEncryptionAvailable()) {
    live.urlEncrypted = safeStorage.encryptString(live.url).toString('base64')
    delete live.url
  }
  fs.mkdirSync(path.dirname(configFile()), { recursive: true })
  fs.writeFileSync(configFile(), JSON.stringify({ live, share: Boolean(config.share) }, null, 2))
}

// Connected to another computer over the office network (plain http): let EMS
// treat it as secure, as it would an https site, so the field app's PIN works.
{
  const live = readRawConfig().live
  if (live?.kind === 'remote' && String(live.url ?? '').startsWith('http://')) {
    try {
      app.commandLine.appendSwitch(
        'unsafely-treat-insecure-origin-as-secure',
        new URL(live.url).origin,
      )
    } catch {
      // A bad address is reported when EMS tries to open it.
    }
  }
}

/** This computer's addresses on the office network. */
function networkAddresses() {
  return Object.values(require('node:os').networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address)
}

let config = null

// ── Workspaces ──────────────────────────────────────────────────────────────

const workspaces = {
  live: { name: 'live', label: 'EMS', port: 47821, child: null, origin: null, starting: null },
  demo: { name: 'demo', label: 'EMS demo', port: 47822, child: null, origin: null, starting: null },
}
const windows = new Map()
let requestId = 0
const pending = new Map()
let quitting = false

function isRemote(ws) {
  return ws.name === 'live' && config.live.kind === 'remote'
}

/** Start the workspace's server if needed; resolves with its address. */
function ensureStarted(ws) {
  if (isRemote(ws)) return Promise.resolve(config.live.url.replace(/\/+$/, ''))
  if (ws.origin) return Promise.resolve(ws.origin)
  if (ws.starting) return ws.starting
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  Object.assign(env, {
    EMS_MODE: ws.name,
    // Shared: listen on the office network too. Otherwise this computer only.
    EMS_HOST: ws.name === 'live' && config.share ? '0.0.0.0' : '127.0.0.1',
    EMS_PORT: String(ws.port),
    EMS_PORT_FALLBACK: 'true',
    EMS_WEB_ROOT: WEB_ROOT,
    EMS_DATA_DIR: dataDir(),
    EMS_LICENCE_FILE: path.join(dataDir(), 'licence.key'),
    // The outbox shows sign-in codes: only this computer may read it.
    EMS_OUTBOX: 'local',
  })
  delete env.DATABASE_URL
  if (ws.name === 'live' && config.live.kind === 'postgres') {
    env.DATABASE_URL = config.live.url
    env.EMS_DB_SCHEMA = config.live.schema || 'ems'
  }
  ws.starting = new Promise((resolve, reject) => {
    const child = utilityProcess.fork(SERVER_MAIN, [], {
      env,
      serviceName: `EMS ${ws.name} server`,
      stdio: 'pipe',
    })
    ws.child = child
    let failure = ''
    child.stdout?.on('data', (d) => process.stdout.write(`[${ws.name}] ${d}`))
    child.stderr?.on('data', (d) => {
      failure += d
      process.stderr.write(`[${ws.name}] ${d}`)
    })
    child.on('message', (message) => {
      if (message.type === 'ready') {
        ws.origin = `http://127.0.0.1:${message.port}`
        resolve(ws.origin)
      } else if (message.type === 'failed') {
        failure = message.message
      } else if (message.type === 'sms') {
        notifySms(ws, message.sms)
      } else if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message)
        pending.delete(message.id)
      }
    })
    child.on('exit', (code) => {
      const wasRunning = Boolean(ws.origin)
      ws.child = null
      ws.origin = null
      ws.starting = null
      if (!wasRunning) {
        reject(new Error(failure.trim() || `The ${ws.name} server stopped (code ${code}).`))
        return
      }
      if (!quitting && !ws.stopping) {
        dialog.showErrorBox(
          `EMS ${ws.name === 'demo' ? 'demo workspace' : ''} stopped`,
          `EMS stopped to protect your data.\n\n${failure.trim().split('\n').slice(-3).join('\n')}\n\nIt will start again when you reopen a window.`,
        )
        closeWindows(ws)
      }
      ws.stopping = false
    })
  })
  ws.starting.catch(() => {
    ws.starting = null
  })
  return ws.starting
}

function stopWorkspace(ws) {
  const child = ws.child
  if (!child) return Promise.resolve()
  ws.stopping = true
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill()
      resolve()
    }, 5000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.postMessage({ type: 'shutdown' })
  })
}

/** Ask a workspace's server something (status, backup). */
function ask(ws, message) {
  return new Promise((resolve, reject) => {
    if (!ws.child) return reject(new Error('That workspace isn’t running.'))
    const id = ++requestId
    pending.set(id, resolve)
    ws.child.postMessage({ ...message, id })
  })
}

function notifySms(ws, sms) {
  if (!Notification.isSupported()) return
  const title = `${ws.name === 'demo' ? 'Demo: ' : ''}SMS to ${sms.to}`
  new Notification({ title, body: sms.message }).show()
}

// ── Windows ─────────────────────────────────────────────────────────────────

/** Links the web app uses to ask for desktop features. */
function desktopAction(url) {
  try {
    if (new URL(url).pathname === '/__desktop/connection-settings') {
      openConnectionSettings()
      return true
    }
  } catch {
    // not a URL we handle
  }
  return false
}

function keepLinksInApp(win, origin) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (desktopAction(url)) return { action: 'deny' }
    if (url.startsWith(origin)) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (desktopAction(url)) {
      event.preventDefault()
      return
    }
    if (!url.startsWith(origin)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
}

const VIEWS = {
  office: { route: '/', width: 1360, height: 880, minWidth: 1024, minHeight: 640, title: '' },
  field: {
    route: '/field/today',
    width: 412,
    height: 860,
    minWidth: 360,
    minHeight: 600,
    title: ' Field',
  },
  sms: {
    route: '/__sms',
    width: 440,
    height: 640,
    minWidth: 360,
    minHeight: 400,
    title: ' SMS outbox',
  },
}

async function open(wsName, view) {
  const ws = workspaces[wsName]
  const key = `${wsName}:${view}`
  const existing = windows.get(key)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }
  if (view === 'sms' && isRemote(ws)) {
    await dialog.showMessageBox({
      type: 'info',
      title: 'SMS outbox',
      message: 'Text messages are sent by your organisation’s EMS server.',
      detail: 'Ask the person who runs it for the SMS outbox link.',
    })
    return
  }
  let origin
  try {
    origin = await ensureStarted(ws)
  } catch (error) {
    dialog.showErrorBox(
      'EMS couldn’t start',
      `${error.message}\n\nCheck File → Connection settings.`,
    )
    return
  }
  const spec = VIEWS[view]
  const win = new BrowserWindow({
    width: spec.width,
    height: spec.height,
    minWidth: spec.minWidth,
    minHeight: spec.minHeight,
    title: ws.label + spec.title,
    backgroundColor: PAPER,
    show: false,
    icon: ICON,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  if (view === 'sms') win.setMenuBarVisibility(false)
  keepLinksInApp(win, origin)
  win.once('ready-to-show', () => {
    if (view === 'office') win.maximize()
    win.show()
  })
  win.on('closed', () => {
    if (windows.get(key) === win) windows.delete(key)
  })
  windows.set(key, win)
  void win.loadURL(origin + spec.route)
}

function closeWindows(ws) {
  for (const [key, win] of windows) {
    if (!key.startsWith(`${ws.name}:`)) continue
    // Forget it now: it finishes closing later, and must not be mistaken for an open window.
    windows.delete(key)
    if (!win.isDestroyed()) win.close()
  }
}

/** Keep EMS running while windows are swapped, e.g. when changing the connection. */
let busy = 0
async function whileBusy(task) {
  busy += 1
  try {
    return await task()
  } finally {
    busy -= 1
    if (busy === 0 && BrowserWindow.getAllWindows().length === 0) app.quit()
  }
}

// ── Connection settings window ──────────────────────────────────────────────

let connectionWindow = null

function openConnectionSettings() {
  if (connectionWindow && !connectionWindow.isDestroyed()) {
    connectionWindow.focus()
    return
  }
  connectionWindow = new BrowserWindow({
    width: 620,
    height: 760,
    title: 'EMS connection settings',
    backgroundColor: PAPER,
    icon: ICON,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  connectionWindow.setMenuBarVisibility(false)
  void connectionWindow.loadFile(path.join(__dirname, 'connection.html'))
}

function serverLib() {
  return require(SERVER_LIB)
}

async function testConnection(next) {
  if (next.kind === 'sqlite') return { ok: true, message: 'EMS keeps its data on this computer.' }
  if (next.kind === 'remote') {
    let url
    try {
      url = new URL(next.url)
    } catch {
      return { ok: false, message: 'Enter the full address, e.g. https://ems.yourcompany.ng' }
    }
    try {
      const res = await fetch(new URL('/api/v1/system/status/', url), {
        signal: AbortSignal.timeout(10000),
      })
      const status = await res.json()
      if (!res.ok || typeof status.onboarded !== 'boolean') throw new Error('not EMS')
      return {
        ok: true,
        message: `Connected to ${status.business_name ?? 'an EMS server that isn’t set up yet'}.`,
      }
    } catch {
      return { ok: false, message: 'No EMS server answered at that address.' }
    }
  }
  // PostgreSQL / Supabase. The live server may be holding this very database.
  if (
    config.live.kind === 'postgres' &&
    config.live.url === next.url &&
    (config.live.schema || 'ems') === (next.schema || 'ems')
  )
    return { ok: true, message: 'EMS is already using this database.' }
  let backend
  try {
    backend = serverLib().postgresBackend(next.url, next.schema || 'ems')
    await backend.init()
    return {
      ok: true,
      message: `Connected. EMS will keep its tables in the "${next.schema || 'ems'}" schema.`,
    }
  } catch (error) {
    return { ok: false, message: error.message }
  } finally {
    await backend?.close().catch(() => undefined)
  }
}

function saveConnection(next, options) {
  return whileBusy(() => switchConnection(next, options))
}

async function switchConnection(next, { copy }) {
  const live = workspaces.live
  await stopWorkspace(live)
  closeWindows(live)
  try {
    if (next.kind === 'postgres' && copy && config.live.kind === 'sqlite') {
      const lib = serverLib()
      const file = path.join(dataDir(), 'ems.sqlite')
      if (fs.existsSync(file)) {
        const { records } = await lib.copyDatabase(
          new lib.SqliteBackend(file),
          lib.postgresBackend(next.url, next.schema || 'ems'),
        )
        await dialog.showMessageBox({
          type: 'info',
          title: 'Data copied',
          message: `${records.toLocaleString()} records copied to the new database.`,
          detail: 'EMS now uses that database. This computer keeps its old copy as a backup.',
        })
      }
    }
    // A computer that connects to another one doesn't share anything itself.
    config = { live: next, share: next.kind === 'remote' ? false : config.share }
    writeConfig(config)
    buildMenu()
    if (next.kind === 'remote' && next.url.startsWith('http://')) {
      // An office-network address needs a restart to be treated as secure (see top).
      // Registered now, so EMS comes back however it closes (e.g. the settings
      // window closing leaves no windows open).
      app.relaunch()
      setTimeout(() => app.exit(0), 1200)
      return { ok: true }
    }
    await open('live', 'office')
    return { ok: true }
  } catch (error) {
    // Put the old connection back.
    await open('live', 'office').catch(() => undefined)
    return { ok: false, message: error.message }
  }
}

ipcMain.handle('connection:get', () => {
  const { live } = config
  // The database password stays in the main process.
  const shown =
    live.kind === 'postgres'
      ? { kind: 'postgres', host: new URL(live.url).hostname, schema: live.schema || 'ems' }
      : live
  return { live: shown, hasLocalData: fs.existsSync(path.join(dataDir(), 'ems.sqlite')) }
})
ipcMain.handle('connection:test', (_event, next) => testConnection(next))
ipcMain.handle('connection:save', (_event, next, options) => saveConnection(next, options ?? {}))

// ── Office network ─────────────────────────────────────────────────────────

function setSharing(on) {
  return whileBusy(async () => {
    config = { ...config, share: on }
    writeConfig(config)
    const live = workspaces.live
    closeWindows(live)
    await stopWorkspace(live)
    buildMenu()
    await open('live', 'office')
    if (on) await showNetworkAddress()
  })
}

async function showNetworkAddress() {
  const origin = await ensureStarted(workspaces.live).catch(() => null)
  const port = origin ? new URL(origin).port : workspaces.live.port
  const addresses = networkAddresses().map((ip) => `http://${ip}:${port}`)
  await dialog.showMessageBox({
    type: 'info',
    title: 'Share on office network',
    message: addresses.length
      ? 'Other computers on this network can now use this EMS.'
      : 'This computer isn’t connected to a network.',
    detail: [
      ...(addresses.length
        ? [
            'On each other computer: install EMS, open File → Connection settings…, choose “On my organisation’s EMS server” and enter:',
            '',
            ...addresses,
            '',
            'If Windows asks whether to allow EMS on the network, choose Allow (private networks).',
          ]
        : []),
      'This computer must be switched on with EMS open while others use it. Its address can change when it reconnects: ask whoever manages the router to reserve it.',
    ].join('\n'),
  })
}

// ── Menu actions ────────────────────────────────────────────────────────────

async function backUp() {
  const live = workspaces.live
  if (isRemote(live)) {
    await dialog.showMessageBox({
      type: 'info',
      title: 'Backups',
      message: 'Your organisation’s EMS server keeps the data, so back it up there.',
    })
    return
  }
  const stamp = new Date().toISOString().slice(0, 10)
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Back up EMS data',
    defaultPath: path.join(app.getPath('documents'), `EMS-backup-${stamp}.sqlite`),
    filters: [{ name: 'EMS backup', extensions: ['sqlite'] }],
  })
  if (canceled || !filePath) return
  try {
    await ensureStarted(live)
    fs.rmSync(filePath, { force: true })
    const reply = await ask(live, { type: 'backup', file: filePath })
    if (reply.type === 'error') throw new Error(reply.message)
    await dialog.showMessageBox({
      type: 'info',
      title: 'Backup saved',
      message: 'Your EMS data is backed up.',
      detail: `${filePath}\n\nKeep a copy somewhere other than this computer, such as a USB drive or Google Drive.`,
    })
  } catch (error) {
    dialog.showErrorBox('Backup failed', String(error?.message ?? error))
  }
}

function resetDemo() {
  return whileBusy(resetDemoWorkspace)
}

async function resetDemoWorkspace() {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Reset demo data', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Reset demo data',
    message: 'Start the demo workspace again with fresh sample data?',
    detail: 'Everything done in the demo workspace is removed. Your live data isn’t touched.',
  })
  if (response !== 0) return
  const demo = workspaces.demo
  closeWindows(demo)
  await stopWorkspace(demo)
  for (const suffix of ['', '-wal', '-shm'])
    fs.rmSync(path.join(dataDir(), `demo.sqlite${suffix}`), { force: true })
  await session.defaultSession.clearStorageData({ origin: `http://127.0.0.1:${demo.port}` })
  await open('demo', 'office')
}

async function showLicence() {
  let status
  try {
    const live = workspaces.live
    if (isRemote(live)) {
      const res = await fetch(new URL('/api/v1/system/status/', config.live.url))
      const body = await res.json()
      status = { ...body, businessName: body.business_name, machineCode: body.machine_code }
    } else {
      await ensureStarted(live)
      status = (await ask(live, { type: 'status' })).status
    }
  } catch (error) {
    dialog.showErrorBox('Licence details', error.message)
    return
  }
  const { licence } = status
  const lines = licence
    ? [
        `Licence: ${licence.id ?? '—'}`,
        `Licensed to: ${licence.licensee ?? '—'}`,
        `Plan: ${licence.plan ?? '—'}`,
        `Branches: ${licence.branches ?? 'Unlimited'}`,
        `Valid until: ${licence.expires ?? 'No end date'}`,
        `Status: ${licence.status}`,
      ]
    : ['No licence entered yet.']
  const where =
    config.live.kind === 'remote'
      ? `Connected to ${config.live.url}`
      : config.live.kind === 'postgres'
        ? 'Data: Supabase / PostgreSQL'
        : `Data: ${path.join(dataDir(), 'ems.sqlite')}`
  await dialog.showMessageBox({
    type: 'info',
    title: 'EMS licence',
    message: status.businessName ?? 'EMS licence',
    detail: [...lines, '', where, `This computer’s code: ${status.machineCode ?? '—'}`].join('\n'),
  })
}

async function eraseInstallation() {
  const first = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Continue', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Erase EMS on this computer',
    message: 'Erase all EMS data, the licence and the connection settings on this computer?',
    detail:
      'Every customer, account, loan, transaction, staff member and setting kept on this computer is deleted, including the demo workspace, and EMS goes back to asking for a licence. Data in a Supabase database or on your organisation’s server is not deleted. Back up first if you might need the data.',
  })
  if (first.response !== 0) return
  const second = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Erase everything', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Erase EMS on this computer',
    message: 'This can’t be undone. Erase now?',
  })
  if (second.response !== 0) return
  quitting = true
  await Promise.all(Object.values(workspaces).map(stopWorkspace))
  fs.rmSync(dataDir(), { recursive: true, force: true })
  fs.rmSync(configFile(), { force: true })
  await session.defaultSession.clearStorageData()
  app.relaunch()
  app.exit(0)
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Back office', accelerator: 'CmdOrCtrl+1', click: () => open('live', 'office') },
        {
          label: 'Field app (phone size)',
          accelerator: 'CmdOrCtrl+2',
          click: () => open('live', 'field'),
        },
        { label: 'SMS outbox', accelerator: 'CmdOrCtrl+3', click: () => open('live', 'sms') },
        { type: 'separator' },
        {
          label: 'Demo workspace',
          submenu: [
            {
              label: 'Demo back office',
              accelerator: 'CmdOrCtrl+Shift+1',
              click: () => open('demo', 'office'),
            },
            {
              label: 'Demo field app',
              accelerator: 'CmdOrCtrl+Shift+2',
              click: () => open('demo', 'field'),
            },
            {
              label: 'Demo SMS outbox',
              accelerator: 'CmdOrCtrl+Shift+3',
              click: () => open('demo', 'sms'),
            },
            { type: 'separator' },
            { label: 'Reset demo data…', click: () => void resetDemo() },
          ],
        },
        { type: 'separator' },
        { label: 'Back up live data…', click: () => void backUp() },
        { label: 'Open data folder', click: () => void shell.openPath(dataDir()) },
        { label: 'Connection settings…', click: openConnectionSettings },
        {
          label: 'Share on office network',
          type: 'checkbox',
          checked: Boolean(config.share),
          enabled: config.live.kind !== 'remote',
          click: (item) => void setSharing(item.checked),
        },
        {
          label: 'Office network address…',
          enabled: Boolean(config.share) && config.live.kind !== 'remote',
          click: () => void showNetworkAddress(),
        },
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
        { label: 'Licence details', click: () => void showLicence() },
        {
          label: 'About EMS',
          click: () =>
            dialog.showMessageBox({
              title: 'About EMS',
              message: `Entacrest MFB Solution (EMS) ${app.getVersion()}`,
              detail: `An Entacrest Nexus product.\n\nData folder: ${dataDir()}`,
            }),
        },
        { type: 'separator' },
        { label: 'Erase EMS on this computer…', click: () => void eraseInstallation() },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── Start ───────────────────────────────────────────────────────────────────

if (!app.requestSingleInstanceLock()) {
  // A second copy would fight over the ports and the databases.
  app.quit()
} else {
  app.on('second-instance', () => void open('live', 'office'))
  app.setAppUserModelId('ng.entacrest.ems')

  void app.whenReady().then(async () => {
    config = readConfig()
    // Earlier test builds ran a mock service worker at the live address.
    await session.defaultSession.clearStorageData({ storages: ['serviceworkers'] })
    buildMenu()
    await open('live', 'office')
  })

  app.on('window-all-closed', () => {
    if (busy === 0) app.quit()
  })
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    void Promise.all(Object.values(workspaces).map(stopWorkspace)).then(() => app.quit())
  })
}
