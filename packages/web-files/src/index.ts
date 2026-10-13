// 浏览器端的文件对话框和下载适配器：在虚拟文件系统上实现 showOpenDialog / showSaveDialog / shell.openPath。
//   - 保存：同步返回 <downloads>/<文件名>，插件往这个路径写完文件后由浏览器下载（写入停止一小段时间后触发）
//   - 选目录且带 createDirectory（一般是「选导出目录」）：同步返回 <downloads>，写进去的每个文件都会下载
//   - 打开：浏览器只能异步选文件。异步版（openAsync）直接返回 <picked> 下的路径；
//     同步版返回 undefined，同时弹出选择器，选中后交给 onDeferredPick（web 运行时默认把它当作一次 files 进入）
import type { DialogCapability, ShellCapability } from '@whatevertools/core'

/** 用到的虚拟文件系统接口（@whatevertools/fs-virtual 的 VirtualFs 满足） */
export interface WebFilesFs {
  mkdirSync(path: string, opts?: { recursive?: boolean }): void
  writeFileSync(path: string, data: Uint8Array): void
  readFile(path: string): Promise<Uint8Array>
  statSync(path: string): { isFile: boolean } | null
  watch(path: string, fn: (e: 'rename' | 'change', f: string | null) => void, opts?: { recursive?: boolean }): () => unknown
}

export interface WebFilesOptions {
  fs: WebFilesFs
  /** 待下载目录，默认 /downloads */
  downloadsDir?: string
  /** 选中文件放在哪，默认 /picked */
  pickedDir?: string
  /** 同步打开对话框：用户选完文件后的回调（不给就丢弃选择结果） */
  onDeferredPick?(paths: string[], options: Record<string, unknown>): void
  /** 触发下载，默认用 <a download> */
  download?(name: string, data: Uint8Array, mime: string): void
  /** 文件写完多久没再变化才下载（毫秒），默认 400 */
  settleMs?: number
}

export interface WebFiles {
  dialog: DialogCapability
  shell: Pick<ShellCapability, 'openPath' | 'showItemInFolder'>
  downloadsDir: string
  pickedDir: string
  /** 异步选择文件（必须在用户点击等手势里调用，否则浏览器会拦截） */
  pick(options?: Record<string, unknown>): Promise<string[] | undefined>
  dispose(): void
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml',
  json: 'application/json', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', html: 'text/html', pdf: 'application/pdf', zip: 'application/zip',
}
const ext = (name: string) => (/\.([^.\/]+)$/.exec(name)?.[1] ?? '').toLowerCase()
const baseName = (p: string) => String(p).replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? ''

function anchorDownload(name: string, data: Uint8Array, mime: string) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** filters（Electron 格式）→ <input accept> */
function acceptOf(options: Record<string, unknown>) {
  const filters = (options.filters as Array<{ extensions?: string[] }> | undefined) ?? []
  const exts = filters.flatMap((f) => f.extensions ?? []).filter((e) => e && e !== '*')
  return exts.length ? exts.map((e) => '.' + e.replace(/^\./, '')).join(',') : ''
}

export function createWebFiles(o: WebFilesOptions): WebFiles {
  const downloadsDir = o.downloadsDir ?? '/downloads'
  const pickedDir = o.pickedDir ?? '/picked'
  const download = o.download ?? anchorDownload
  const settle = o.settleMs ?? 400
  o.fs.mkdirSync(downloadsDir, { recursive: true })
  o.fs.mkdirSync(pickedDir, { recursive: true })

  // 写进下载目录的文件：停止变化后下载
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const fire = async (path: string) => {
    timers.delete(path)
    if (!o.fs.statSync(path)?.isFile) return
    const data = await o.fs.readFile(path)
    const name = baseName(path)
    download(name, data, MIME[ext(name)] ?? 'application/octet-stream')
  }
  const unwatch = o.fs.watch(downloadsDir, (_e, f) => {
    if (!f) return
    const path = `${downloadsDir}/${f}`
    clearTimeout(timers.get(path))
    timers.set(path, setTimeout(() => void fire(path), settle))
  }, { recursive: true })

  const inDownloads = (p: string) => p === downloadsDir || String(p).startsWith(downloadsDir + '/')
  const savePath = (options: Record<string, unknown> = {}) => `${downloadsDir}/${baseName(String(options.defaultPath ?? '')) || 'download'}`
  const wantsWriteDir = (options: Record<string, unknown>) => {
    const props = (options.properties as string[] | undefined) ?? []
    return props.includes('openDirectory') && props.includes('createDirectory')
  }

  let seq = 0
  const pick = (options: Record<string, unknown> = {}) =>
    new Promise<string[] | undefined>((resolve) => {
      const props = (options.properties as string[] | undefined) ?? []
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = props.includes('multiSelections')
      if (props.includes('openDirectory')) (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true
      const accept = acceptOf(options)
      if (accept && !props.includes('openDirectory')) input.accept = accept
      input.style.display = 'none'
      let done = false
      const finish = (v: string[] | undefined) => {
        if (done) return
        done = true
        input.remove()
        resolve(v)
      }
      input.addEventListener('cancel', () => finish(undefined))
      input.addEventListener('change', async () => {
        const files = Array.from(input.files ?? [])
        if (!files.length) return finish(undefined)
        const dir = `${pickedDir}/${Date.now()}-${++seq}`
        const roots = new Set<string>()
        for (const f of files) {
          // 选目录时保留相对路径（webkitRelativePath = 目录名/子路径）
          const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
          const p = `${dir}/${rel}`
          o.fs.mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true })
          o.fs.writeFileSync(p, new Uint8Array(await f.arrayBuffer()))
          roots.add(props.includes('openDirectory') ? `${dir}/${rel.split('/')[0]}` : p)
        }
        finish([...roots])
      })
      document.body.appendChild(input)
      input.click()
    })

  const dialog: DialogCapability = {
    showSaveDialogSync: (options) => savePath(options),
    showSaveDialog: async (options) => savePath(options),
    showOpenDialogSync: (options = {}) => {
      if (wantsWriteDir(options)) return [downloadsDir]
      void pick(options).then((paths) => paths?.length && o.onDeferredPick?.(paths, options))
      return undefined
    },
    showOpenDialog: async (options = {}) => (wantsWriteDir(options) ? [downloadsDir] : pick(options)),
  }

  const shell: WebFiles['shell'] = {
    // 下载目录里的文件：重新下载一次；其他路径浏览器打不开
    openPath: async (p) => {
      if (!inDownloads(p) || !o.fs.statSync(p)?.isFile) return '浏览器端只能打开已下载的文件'
      await fire(p)
      return ''
    },
    showItemInFolder: () => {},
  }

  return {
    dialog,
    shell,
    downloadsDir,
    pickedDir,
    pick,
    dispose: () => {
      unwatch()
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
    },
  }
}
