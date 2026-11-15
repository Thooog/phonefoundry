import { build } from 'vite'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const children = []
let stopping = false
const watcher = await build({ root: `${root}/apps/player`, configFile: `${root}/apps/player/vite.config.js`, build: { watch: {} } })
async function stop() {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill()
  await watcher.close()
}
watcher.on('event', event => {
  if (event.code === 'ERROR') console.error(event.error)
  if (event.code !== 'END' || children.length || stopping) return
  for (const app of ['creator', 'player']) {
    const port = process.env[`PHONE_SIM_${app.toUpperCase()}_PORT`] ?? (app === 'creator' ? '5173' : '5174')
    const child = spawn(process.execPath, [vite, '--port', port], { cwd: `${root}/apps/${app}`, stdio: 'inherit', windowsHide: true })
    children.push(child)
    child.on('exit', code => { process.exitCode = code ?? 0; void stop() })
  }
})
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
