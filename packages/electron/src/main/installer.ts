// 动态安装插件包（upx / asar / zip）：解包 → 读描述文件 → 安装策略 + plugin:install hook → 用户确认 → 装进数据目录并加载。
// 装好的插件记在宿主存储里（installed），重启后自动加载；同一个 id 再装一次就是升级。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { dialog } from 'electron'
import { checkInstall, loadManifest, type InstallCandidate, type InstalledRecord, type InstallPolicy, type PluginManifest } from '@whatevertools/core'
import { openPackage } from '@whatevertools/upx'
import type { WhateverToolsHost } from './host'
import type { PluginRuntime } from './plugin'

export interface InstallOptions {
  /** 来源（展示用），默认文件路径 */
  source?: string
  /** 覆盖策略里的 confirm */
  confirm?: boolean
  /** 只装到临时目录、不记录（wt run 直接运行一个包） */
  temporary?: boolean
}

const STORE_KEY = 'installed'

export class PluginInstaller {
  constructor(private host: WhateverToolsHost, private policy: InstallPolicy) {}

  get root() {
    return path.join(this.host.dataDir, 'installed')
  }

  list(): InstalledRecord[] {
    return this.host.store.get<InstalledRecord[]>(STORE_KEY) ?? []
  }

  private save(list: InstalledRecord[]) {
    this.host.store.set(STORE_KEY, list)
    // 安装记录立即落盘：装完就崩溃也不能丢
    this.host.store.flushSync()
  }

  /** 启动时加载已安装的插件（目录丢了的条目清掉） */
  loadAll(): PluginRuntime[] {
    const out: PluginRuntime[] = []
    const keep: InstalledRecord[] = []
    for (const r of this.list()) {
      if (!fs.existsSync(r.dir)) {
        this.host.log('warn', `已安装的插件 ${r.id} 目录不见了，移除记录`)
        continue
      }
      keep.push(r)
      try {
        out.push(this.host.loadPlugin(r.dir))
      } catch (e: any) {
        this.host.log('error', `加载已安装的插件失败：${r.id}`, e.message)
      }
    }
    if (keep.length !== this.list().length) this.save(keep)
    return out
  }

  private readManifest(dir: string): PluginManifest {
    const files = (this.host as any).readManifestFiles(dir, [...new Set(this.host.manifestLoaders.flatMap((l) => l.files))])
    return loadManifest(this.host.manifestLoaders, { dir, files })
  }

  /** 安装一个包（文件路径或字节）；用户取消或策略不允许时抛错（code: EWTINSTALL） */
  async install(input: string | Uint8Array, opts: InstallOptions = {}): Promise<PluginRuntime> {
    const fail = (msg: string): never => {
      throw Object.assign(new Error(msg), { code: 'EWTINSTALL' })
    }
    const name = typeof input === 'string' ? path.basename(input) : undefined
    const bytes = typeof input === 'string' ? new Uint8Array(fs.readFileSync(input)) : input
    const pkg = await openPackage(bytes, { name })
    // 先解到临时目录，读出完整描述再决定装不装
    const tmp = opts.temporary ? fs.mkdtempSync(path.join(os.tmpdir(), 'wt-plugin-')) : path.join(this.root, `.tmp-${crypto.randomUUID()}`)
    fs.mkdirSync(tmp, { recursive: true })
    try {
      for (const [rel, data] of pkg.files) {
        const dst = path.join(tmp, rel)
        if (!dst.startsWith(tmp + path.sep)) fail(`包里有不安全的路径：${rel}`)
        fs.mkdirSync(path.dirname(dst), { recursive: true })
        fs.writeFileSync(dst, data)
      }
      const manifest = this.readManifest(tmp)
      if (opts.temporary) return this.host.loadPlugin(tmp)

      const installed = this.list()
      const prev = installed.find((r) => r.id === manifest.id)
      if (!prev && this.host.plugins.has(manifest.id)) fail(`已经有一个 id 为 ${manifest.id} 的插件（不是动态安装的），不能覆盖`)
      const cand: InstallCandidate = {
        id: manifest.id, name: manifest.name, version: manifest.version, description: manifest.description,
        format: pkg.format, permissions: manifest.permissions, previousVersion: prev?.version, source: opts.source ?? (typeof input === 'string' ? input : undefined),
      }
      const reason = checkInstall(this.policy, cand, installed)
      if (reason) fail(reason)
      const allowed = await this.host.hooks.runApply('plugin:install', { plugin: manifest.id }, this, [cand], async (a) => this.confirm(a[0] as InstallCandidate, opts.confirm ?? this.policy.confirm ?? true))
      if (allowed === false) fail('已取消安装')

      const dir = path.join(this.root, manifest.id)
      if (prev || this.host.plugins.has(manifest.id)) this.host.unloadPlugin(manifest.id)
      fs.rmSync(dir, { recursive: true, force: true })
      fs.renameSync(tmp, dir)
      const plugin = this.host.loadPlugin(dir)
      this.save([...installed.filter((r) => r.id !== manifest.id), { id: manifest.id, version: manifest.version, dir, format: pkg.format, source: cand.source, installedAt: Date.now() }])
      this.host.log('info', `${prev ? '升级' : '安装'}了插件 ${manifest.name}（${manifest.id}@${manifest.version}）`)
      return plugin
    } finally {
      if (!opts.temporary) fs.rmSync(tmp, { recursive: true, force: true })
    }
  }

  /** 卸载动态安装的插件（删除目录和记录；插件数据目录保留，重新安装后还在） */
  uninstall(id: string) {
    const list = this.list()
    const r = list.find((x) => x.id === id)
    if (!r) throw Object.assign(new Error(`${id} 不是动态安装的插件`), { code: 'EWTINSTALL' })
    if (this.host.plugins.has(id)) this.host.unloadPlugin(id)
    fs.rmSync(r.dir, { recursive: true, force: true })
    this.save(list.filter((x) => x.id !== id))
  }

  private async confirm(c: InstallCandidate, ask: boolean) {
    if (!ask) return true
    if (process.env.WHATEVERTOOLS_HEADLESS) return false
    const perms = Object.entries(c.permissions)
    const detail = [
      c.previousVersion ? `从 ${c.previousVersion} 升级到 ${c.version}` : `版本 ${c.version}`,
      c.description,
      perms.length ? `\n插件说明的用途（使用时仍会逐项询问）：\n${perms.map(([k, v]) => `· ${k}${v.reason ? `：${v.reason}` : ''}`).join('\n')}` : '',
      c.source ? `\n来源：${c.source}` : '',
    ].filter(Boolean).join('\n')
    const r = await dialog.showMessageBox({ type: 'question', message: `${c.previousVersion ? '升级' : '安装'}插件「${c.name}」？`, detail, buttons: [c.previousVersion ? '升级' : '安装', '取消'], defaultId: 0, cancelId: 1 })
    return r.response === 0
  }
}
