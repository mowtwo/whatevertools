// 数据库、动态功能、跳转、快捷键、付费
import type { Feature } from '@whatevertools/core'
import type { Handler } from '../types'

const db = (name: string): Handler => async (c, ...args) => {
  await c.plugin.dbReady
  return (c.plugin.db as any)[name](...args)
}

export const dataSvc: Record<string, Handler> = {
  'db.put': db('put'),
  'db.get': db('get'),
  'db.remove': async (c, d) => {
    await c.plugin.dbReady
    // 附件也通过 remove 删除
    const id = typeof d === 'string' ? d : d?._id
    if (typeof id === 'string' && c.plugin.db.getAttachmentType(id) !== null) return c.plugin.db.removeAttachment(id)
    return c.plugin.db.remove(d)
  },
  'db.bulk': db('bulkDocs'),
  'db.all': db('allDocs'),
  'db.putAttachment': async (c, id: string, data: Uint8Array, type: string) => {
    await c.plugin.dbReady
    return c.plugin.db.postAttachment(id, data, type)
  },
  'db.getAttachment': db('getAttachment'),
  'db.getAttachmentType': db('getAttachmentType'),
  'db.syncState': (c) => c.plugin.replicator?.state ?? null,
  'kv.set': db('setItem'),
  'kv.get': db('getItem'),
  'kv.remove': db('removeItem'),

  'features.list': (c, codes?: string[]) => c.host.features.list(c.plugin.id, codes),
  'features.set': (c, feature: Feature) => c.host.features.set(c.plugin.id, feature, c.plugin.manifest.features.map((f) => f.code)),
  'features.remove': (c, code: string) => c.host.features.remove(c.plugin.id, code),
  'launch.open': async (c, label: string | [string, string], payload?: unknown) => {
    const [pluginName, cmd] = Array.isArray(label) ? label : [undefined, label]
    const candidates: Array<{ pluginId: string; code: string; label: string; type: string }> = []
    for (const p of c.host.plugins.values()) {
      if (pluginName && p.manifest.name !== pluginName && p.id !== pluginName) continue
      for (const f of p.allFeatures()) {
        for (const x of f.cmds) {
          const l = typeof x === 'string' ? x : x.label
          // 匹配指令（文件 / 图片 / 正则……）必须带上满足规则的数据，否则不算候选
          if (l === cmd && (typeof x === 'string' || payload !== undefined)) candidates.push({ pluginId: p.id, code: f.code, label: l, type: typeof x === 'string' ? 'text' : x.type })
        }
      }
    }
    if (!candidates.length) return false
    let pick = 0
    if (candidates.length > 1) {
      const r = await c.host.panel<Promise<number | undefined>>('chooseFeature', null, [candidates], async () => 0)
      if (r === undefined) return false
      pick = r
    }
    const t = candidates[pick]
    let type = t.type as any
    let data: unknown = t.label
    if (payload !== undefined) {
      if (typeof payload === 'string') data = payload
      else if (payload && typeof payload === 'object') {
        const pl = payload as { type: 'img' | 'files'; data: string | string[] }
        type = pl.type
        if (pl.type === 'files') {
          const fs = require('node:fs')
          const path = require('node:path')
          data = (Array.isArray(pl.data) ? pl.data : [pl.data]).map((p: string) => {
            const st = fs.statSync(p, { throwIfNoEntry: false })
            return { path: p, name: path.basename(p), isFile: !!st?.isFile(), isDirectory: !!st?.isDirectory() }
          })
        } else data = pl.data
      }
    }
    if (!c.host.sources.list().some((x) => x.id === 'redirect')) throw new Error('[whatevertools] 插件跳转（redirect 入口）已被宿主禁用')
    await c.host.sources.context('redirect').enter({ pluginId: t.pluginId, code: t.code, type, payload: data })
    return true
  },
  'hotkeys.openSettings': (c, label: string, autocopy = false) => {
    c.host.panel('openHotkeySetting', c.plugin, [label, !!autocopy], () => c.host.log('warn', `宿主没有快捷键设置界面（launch.openHotkeySetting: ${label}）`))
  },
  'hotkeys.get': (c, label: string) => c.host.hotkeys.get(c.plugin.id, label) ?? null,

  'billing.isPurchased': (c) => c.host.provider(c.plugin, 'billing', 'isPurchased', [], () => true),
  'billing.purchase': (c, options) => c.host.provider(c.plugin, 'billing', 'purchase', [options], () => false),
}

