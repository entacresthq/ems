// Starts the desktop app from npm. VS Code and some tools set ELECTRON_RUN_AS_NODE,
// which makes Electron behave as plain Node and the app fail to open.
const { spawn } = require('node:child_process')
const electron = require('electron') // the path to the Electron binary when run from Node

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env })
child.on('exit', (code) => process.exit(code ?? 0))
