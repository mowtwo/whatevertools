// 宿主数据库：files（键 <id>/<代>/<路径>）、records（键 插件 id）、meta（宿主配置）。
// Service Worker（sw.ts）里有一份同样的打开逻辑，改结构时两边一起改，并调高 DB_VERSION。

export const DB_VERSION = 1

/** 每个作用域一个库：同一个站点挂多个宿主互不干扰 */
export const dbName = (scopePath: string) => `whatevertools-host:${scopePath}`

export function openHostDb(name: string, idb: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = idb.open(name, DB_VERSION)
    r.onupgradeneeded = () => {
      const db = r.result
      for (const s of ['files', 'records', 'meta']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s)
    }
    r.onsuccess = () => {
      const db = r.result
      // 别的页面升级库结构时让出连接
      db.onversionchange = () => db.close()
      resolve(db)
    }
    r.onerror = () => reject(r.error)
    r.onblocked = () => reject(new Error('IndexedDB 被其他页面占用，关掉旧页面后重试'))
  })
}

export const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })

export const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务被中止'))
  })

/** 以 prefix 开头的所有键 */
export const prefixRange = (prefix: string) => IDBKeyRange.bound(prefix, prefix + '￿')
