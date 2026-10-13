// Node 版宿主状态存储：一个 JSON 文件，变更后合并写盘（原子替换 + fsync）
import fs from 'node:fs'
import path from 'node:path'
import { MemoryHostStore } from '@whatevertools/core'

export class JsonFileHostStore extends MemoryHostStore {
  private timer: NodeJS.Timeout | null = null

  constructor(private file: string) {
    super()
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
      for (const [k, v] of Object.entries(raw)) this.data.set(k, v)
    } catch (e: any) {
      if (e.code !== 'ENOENT') {
        try {
          fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`)
        } catch {}
      }
    }
  }

  protected changed() {
    if (this.timer) return
    this.timer = setTimeout(() => this.flushSync(), 100)
  }

  flushSync() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    const fd = fs.openSync(tmp, 'w')
    try {
      fs.writeSync(fd, JSON.stringify(Object.fromEntries(this.data), null, 2))
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(tmp, this.file)
  }
}
