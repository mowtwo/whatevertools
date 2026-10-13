// 共享文件夹同步：每台设备只追加写自己的 <namespace>/<device>.jsonl，读取别的设备的文件。
// 没有并发写同一个文件的问题，适合 iCloud Drive / Dropbox / Syncthing / NAS 这类文件同步工具。
import fs from 'node:fs'
import path from 'node:path'
import type { SyncAdapter, SyncChange } from '@whatevertools/core'

export interface FolderSyncOptions {
  /** 共享文件夹 */
  dir: string
  /** 本机设备 id（文件名用） */
  device: string
}

type Cursor = Record<string, number>

const safe = (s: string) => s.replace(/[^\w.-]+/g, '_')

export class FolderSync implements SyncAdapter {
  readonly name = 'folder'
  constructor(private opts: FolderSyncOptions) {}

  private nsDir(ns: string) {
    const d = path.join(this.opts.dir, safe(ns))
    fs.mkdirSync(d, { recursive: true })
    return d
  }

  async push(ns: string, changes: SyncChange[]) {
    if (!changes.length) return
    const file = path.join(this.nsDir(ns), `${safe(this.opts.device)}.jsonl`)
    await fs.promises.appendFile(file, changes.map((c) => JSON.stringify(c)).join('\n') + '\n')
  }

  async pull(ns: string, cursor: string | null) {
    const dir = this.nsDir(ns)
    const pos: Cursor = cursor ? JSON.parse(cursor) : {}
    const mine = `${safe(this.opts.device)}.jsonl`
    const changes: SyncChange[] = []
    for (const f of await fs.promises.readdir(dir)) {
      if (!f.endsWith('.jsonl') || f === mine) continue
      const full = path.join(dir, f)
      const size = (await fs.promises.stat(full)).size
      const from = pos[f] ?? 0
      if (size <= from) continue
      const fh = await fs.promises.open(full, 'r')
      try {
        const buf = Buffer.alloc(size - from)
        await fh.read(buf, 0, buf.length, from)
        const text = buf.toString('utf8')
        // 只消费完整的行，半行留到下次（文件可能还在同步中）
        const end = text.lastIndexOf('\n')
        if (end < 0) continue
        for (const line of text.slice(0, end).split('\n')) {
          if (!line.trim()) continue
          try {
            changes.push(JSON.parse(line))
          } catch {}
        }
        pos[f] = from + Buffer.byteLength(text.slice(0, end + 1))
      } finally {
        await fh.close()
      }
    }
    changes.sort((a, b) => a.ts - b.ts)
    return { changes, cursor: JSON.stringify(pos) }
  }

  watch(ns: string, onRemote: () => void) {
    let timer: NodeJS.Timeout | null = null
    const w = fs.watch(this.nsDir(ns), (_e, f) => {
      if (!f || f === `${safe(this.opts.device)}.jsonl`) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(onRemote, 300)
    })
    // 共享文件夹被卸载等错误不能让进程崩溃：停止监听，退回定时拉取
    w.on('error', () => w.close())
    return () => w.close()
  }
}
