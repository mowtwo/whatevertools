// 宿主状态存储：权限结论、快捷键、动态功能、定时任务、设备 id 等宿主自己的数据。
// 平台实现：Node 用 JSON 文件（electron 包）、浏览器用 localStorage（web 包）、以后 tauri 用 store 插件。
// 读是同步的（启动时整体加载到内存），写由实现决定何时落盘。

export interface HostStore {
  get<T = unknown>(key: string): T | undefined
  set(key: string, value: unknown): void
  delete(key: string): void
  keys(prefix?: string): string[]
  /** 启动时加载（异步实现用） */
  load?(): Promise<void>
  /** 退出前同步落盘 */
  flushSync?(): void
}

export class MemoryHostStore implements HostStore {
  protected data = new Map<string, unknown>()
  get<T>(key: string) {
    const v = this.data.get(key)
    return v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as T)
  }
  set(key: string, value: unknown) {
    if (value === undefined) this.data.delete(key)
    else this.data.set(key, JSON.parse(JSON.stringify(value)))
    this.changed()
  }
  delete(key: string) {
    this.data.delete(key)
    this.changed()
  }
  keys(prefix = '') {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix))
  }
  /** 子类在这里落盘 */
  protected changed() {}
}
