// 浏览器端：把部分能力交给本地 bridge 守护进程（@whatevertools/bridge-server）。
// 同步方法用同步 XHR（浏览器主线程允许，但会阻塞，只在旧 API 必须同步时用），异步方法用 fetch。
import type { Capabilities, FsCapability, ProcessCapability, SpawnedProcess } from '@whatevertools/core'

export interface BridgeClientOptions {
  url: string
  token: string
  plugin: string
}

const b64 = (b: Uint8Array) => {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export function createBridgeCaps(o: BridgeClientOptions): Partial<Capabilities> & { fs: FsCapability; process: ProcessCapability } {
  const base = o.url.replace(/\/+$/, '')
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${o.token}` }

  const unwrap = (r: any) => {
    if (r.error) throw Object.assign(new Error(r.error.message), r.error)
    return r.value
  }

  // 权限问询由守护进程弹系统对话框，这里只发请求
  const callSync = (cap: string, method: string, args: unknown[]): any => {
    const x = new XMLHttpRequest()
    x.open('POST', `${base}/v1/call`, false)
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v)
    x.send(JSON.stringify({ plugin: o.plugin, cap, method, args }))
    return unwrap(JSON.parse(x.responseText))
  }

  const call = async (cap: string, method: string, args: unknown[]): Promise<any> =>
    unwrap(await (await fetch(`${base}/v1/call`, { method: 'POST', headers, body: JSON.stringify({ plugin: o.plugin, cap, method, args }) })).json())

  const fsCap: FsCapability = {
    readFileSync: (p) => unb64(callSync('fs', 'readFile', [p])),
    writeFileSync: (p, d, opts) => callSync('fs', 'writeFile', [p, b64(d), opts]),
    statSync: (p, opts) => callSync('fs', 'stat', [p, opts]),
    readdirSync: (p) => callSync('fs', 'readdir', [p]),
    mkdirSync: (p, opts) => callSync('fs', 'mkdir', [p, opts]),
    rmSync: (p, opts) => callSync('fs', 'rm', [p, opts]),
    renameSync: (a, b) => callSync('fs', 'rename', [a, b]),
    copyFileSync: (a, b) => callSync('fs', 'copyFile', [a, b]),
    realpathSync: (p) => callSync('fs', 'realpath', [p]),
    readFile: async (p) => unb64(await call('fs', 'readFile', [p])),
    writeFile: (p, d, opts) => call('fs', 'writeFile', [p, b64(d), opts]),
    stat: (p, opts) => call('fs', 'stat', [p, opts]),
    readdir: (p) => call('fs', 'readdir', [p]),
    mkdir: (p, opts) => call('fs', 'mkdir', [p, opts]),
    rm: (p, opts) => call('fs', 'rm', [p, opts]),
    rename: (a, b) => call('fs', 'rename', [a, b]),
    copyFile: (a, b) => call('fs', 'copyFile', [a, b]),
  }

  const processCap: ProcessCapability = {
    spawn(command, args, opts) {
      const out: Array<(d: Uint8Array) => void> = []
      const err: Array<(d: Uint8Array) => void> = []
      const exit: Array<(c: number | null, s: string | null) => void> = []
      let id: string | null = null
      const queue: Array<() => void> = []
      const start = fetch(`${base}/v1/spawn`, { method: 'POST', headers, body: JSON.stringify({ plugin: o.plugin, command, args, cwd: opts?.cwd }) })
        .then((r) => r.json())
        .then((r) => {
          const v = unwrap(r)
          id = v.id
          const es = new EventSource(`${base}/v1/proc/${id}/events?token=${encodeURIComponent(o.token)}`)
          es.addEventListener('stdout', (e) => out.forEach((f) => f(unb64(JSON.parse((e as MessageEvent).data)))))
          es.addEventListener('stderr', (e) => err.forEach((f) => f(unb64(JSON.parse((e as MessageEvent).data)))))
          es.addEventListener('exit', (e) => {
            const d = JSON.parse((e as MessageEvent).data)
            es.close()
            exit.forEach((f) => f(d.code, d.signal))
          })
          queue.splice(0).forEach((f) => f())
        })
        .catch((e) => exit.forEach((f) => f(-1, String(e.message))))
      void start
      const post = (path: string, body: unknown) => {
        const go = () => void fetch(`${base}/v1/proc/${id}/${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
        id ? go() : queue.push(go)
      }
      const p: SpawnedProcess = {
        onStdout: (f) => void out.push(f),
        onStderr: (f) => void err.push(f),
        onExit: (f) => void exit.push(f),
        write: (d) => post('stdin', { data: b64(d) }),
        closeStdin: () => post('stdin', { end: true }),
        kill: (signal) => post('kill', { signal }),
      }
      return p
    },
  }

  return {
    fs: fsCap,
    process: processCap,
    clipboard: {
      readTextSync: () => callSync('clipboard', 'readText', []),
      writeTextSync: (t) => callSync('clipboard', 'writeText', [t]),
      readText: () => call('clipboard', 'readText', []),
      writeText: (t) => call('clipboard', 'writeText', [t]),
    },
    shell: {
      openPath: (p) => call('shell', 'openPath', [p]),
      showItemInFolder: (p) => void call('shell', 'showItemInFolder', [p]),
      trashItem: (p) => call('shell', 'trashItem', [p]),
      openExternal: async (u) => void window.open(u, '_blank', 'noopener'),
    },
  }
}
