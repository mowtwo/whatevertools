// 本地文件存储：db.json 保存全部文档（原子替换写入），附件单独存文件
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { AttachmentMeta, DbBackend, DbDoc, DbSnapshot, DbWrite } from '@whatevertools/core'

interface FileState {
  version: 1
  docs: Record<string, DbDoc>
  attachments: Record<string, AttachmentMeta>
  seq: number
  sync: Record<string, unknown>
}

export interface FileBackendOptions {
  /** 目录，会自动创建 */
  dir: string
  /** 写入时是否格式化 JSON（便于调试） */
  pretty?: boolean
}

export class FileBackend implements DbBackend {
  readonly name = 'file'
  private state: FileState = { version: 1, docs: {}, attachments: {}, seq: 0, sync: {} }
  private file: string
  private attDir: string
  private dirty = false

  constructor(private opts: FileBackendOptions) {
    fs.mkdirSync(opts.dir, { recursive: true })
    this.file = path.join(opts.dir, 'db.json')
    this.attDir = path.join(opts.dir, 'attachments')
  }

  load(): DbSnapshot {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      this.state = { version: 1, docs: raw.docs ?? {}, attachments: raw.attachments ?? {}, seq: raw.seq ?? 0, sync: raw.sync ?? {} }
    } catch (e: any) {
      if (e.code !== 'ENOENT') {
        // 损坏的文件留一份，避免直接覆盖丢数据
        try { fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`) } catch {}
      }
    }
    return { docs: { ...this.state.docs }, attachments: { ...this.state.attachments }, seq: this.state.seq, sync: { ...this.state.sync } }
  }

  write(w: DbWrite) {
    for (const d of w.put ?? []) this.state.docs[d._id] = d
    for (const id of w.delete ?? []) delete this.state.docs[id]
    for (const [id, m] of Object.entries(w.attachmentsMeta ?? {})) {
      if (m) this.state.attachments[id] = m
      else delete this.state.attachments[id]
    }
    if (w.seq !== undefined) this.state.seq = w.seq
    if (w.sync) Object.assign(this.state.sync, w.sync)
    this.dirty = true
    this.flushSync()
  }

  flushSync() {
    if (!this.dirty) return
    const tmp = `${this.file}.${process.pid}.tmp`
    // 先写临时文件并 fsync，再原子替换，断电时不会留下写了一半的 db.json
    const fd = fs.openSync(tmp, 'w')
    try {
      fs.writeSync(fd, this.opts.pretty ? JSON.stringify(this.state, null, 2) : JSON.stringify(this.state))
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(tmp, this.file)
    this.dirty = false
  }

  private attFile(id: string) {
    return path.join(this.attDir, crypto.createHash('sha1').update(id).digest('hex'))
  }

  readAttachment(id: string): Uint8Array | null {
    try {
      return new Uint8Array(fs.readFileSync(this.attFile(id)))
    } catch {
      return null
    }
  }

  writeAttachment(id: string, data: Uint8Array) {
    fs.mkdirSync(this.attDir, { recursive: true })
    fs.writeFileSync(this.attFile(id), data)
  }

  deleteAttachment(id: string) {
    fs.rmSync(this.attFile(id), { force: true })
  }
}
