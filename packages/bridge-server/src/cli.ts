#!/usr/bin/env node
// whatevertools-bridge --origin http://localhost:5173 --root ~/Documents [--port 3540] [--token xxx]
import os from 'node:os'
import path from 'node:path'
import { createBridgeServer } from './index'

const argv = process.argv.slice(2)
const all = (k: string) => argv.flatMap((a, i) => (a === k ? [argv[i + 1]] : []))
const one = (k: string) => all(k)[0]
const expand = (p: string) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p)
const origins = all('--origin')
const roots = all('--root').map(expand)
if (!origins.length || !roots.length) {
  console.error('用法：whatevertools-bridge --origin <网页来源> --root <允许访问的目录> [--port 3540] [--token <令牌>]')
  process.exit(1)
}
const { server, token } = createBridgeServer({ origins, roots, token: one('--token'), grantsFile: path.join(os.homedir(), '.whatevertools-bridge-grants.json') })
const port = Number(one('--port') ?? 3540)
server.listen(port, '127.0.0.1', () => {
  console.log(`whatevertools bridge: http://127.0.0.1:${port}`)
  console.log(`token: ${token}`)
  console.log(`允许的来源：${origins.join(', ')}；允许的目录：${roots.join(', ')}`)
})
