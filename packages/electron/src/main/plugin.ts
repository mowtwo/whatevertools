// Electron 平台的插件状态：在 core 的 CorePlugin 上加主视图、数据库、目录和自定义窗口
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { WebContents } from 'electron'
import { CorePlugin, DocDb, type DbBackend, type FeatureStore, type PermissionSet, type PluginManifest } from '@whatevertools/core'
import { FileBackend } from '@whatevertools/db-file'

export interface OwnedWindow {
  id: number
  wcId: number
  /** 创建它的 webContents（sendToParent 的目标） */
  parentWcId: number
  win: Electron.BrowserWindow
}

export class PluginRuntime extends CorePlugin {
  /** 主界面的 webContents（启动后才有） */
  mainWc: WebContents | null = null
  windows = new Map<number, OwnedWindow>()
  readonly db: DocDb
  readonly dbReady: Promise<void>
  readonly dataDir: string
  readonly tempDir: string
  /** 宿主私有的插件状态目录（数据库等），插件不能直接写 */
  readonly stateDir: string

  constructor(manifest: PluginManifest, hostDataDir: string, perms: PermissionSet, isDev: boolean, featureStore: FeatureStore, backend?: DbBackend) {
    super(manifest, perms, isDev, featureStore)
    const id = manifest.id
    this.stateDir = path.join(hostDataDir, 'plugins', id)
    this.dataDir = path.join(hostDataDir, 'plugin-data', id)
    // 临时目录按宿主数据目录区分，不同宿主的同名插件互不影响
    this.tempDir = path.join(os.tmpdir(), 'whatevertools', Buffer.from(hostDataDir).toString('base64url').slice(-16), id)
    for (const d of [this.stateDir, this.dataDir, this.tempDir]) fs.mkdirSync(d, { recursive: true })
    this.db = new DocDb(backend ?? new FileBackend({ dir: path.join(this.stateDir, 'db') }))
    this.dbReady = this.db.load()
  }

  /** 插件进程结束：清理临时目录 */
  cleanupTemp() {
    try {
      fs.rmSync(this.tempDir, { recursive: true, force: true })
      fs.mkdirSync(this.tempDir, { recursive: true })
    } catch {}
  }
}
