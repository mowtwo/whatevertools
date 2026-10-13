// uTools 的 plugin.json → 中立的 PluginManifest。
// 同目录（或上一级）可以放 whatevertools.json 补充身份、权限、独立打包配置，plugin.json 不用改，不影响 uTools 发布。
import { finalizeManifest, idFromDir, type Feature, type ManifestLoader, type WhateverToolsJson } from '@whatevertools/core'

function feature(f: any): Feature {
  if (!f || typeof f !== 'object') return f
  const { mainHide, mainPush, explain, ...rest } = f
  return { ...rest, description: f.description ?? explain, hidePanel: mainHide ?? f.hidePanel, searchPush: mainPush ?? f.searchPush }
}

export const utoolsManifestLoader: ManifestLoader = {
  id: 'utools',
  files: ['plugin.json', 'whatevertools.json', 'package.json'],
  load({ dir, files }) {
    const pj = files['plugin.json']
    if (!pj) return null
    const extra = (files['whatevertools.json'] ?? {}) as WhateverToolsJson
    const pkg = files['package.json'] ?? {}
    return finalizeManifest(
      dir,
      {
        id: extra.id || pkg.name || idFromDir(dir),
        name: extra.name || pj.pluginName || pkg.productName || pkg.name,
        version: extra.version || pj.version || pkg.version,
        description: extra.description || pj.description || pkg.description,
        main: pj.main,
        logo: pj.logo,
        preload: pj.preload,
        features: Array.isArray(pj.features) ? pj.features.map(feature) : pj.features,
        tools: pj.tools,
        panel: { single: pj.pluginSetting?.single, height: pj.pluginSetting?.height },
        engines: extra.engines,
        permissions: extra.permissions,
        standalone: extra.standalone,
        dev: pj.development ?? extra.dev,
      },
      'utools',
    )
  },
}
