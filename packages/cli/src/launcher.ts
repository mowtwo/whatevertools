// 启动器：whatevertools run [--config whatevertools.config.json] [插件目录...]（= electron <本文件> ...），apps/launcher 打包成应用时也用它
// 配置文件字段见 AppConfig（@whatevertools/electron）；命令行给的插件目录会追加到配置里。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { runApp, type AppConfig } from '@whatevertools/electron'

// 直接用 electron 跑本文件时应用名是「Electron」，数据目录会和其他 Electron 应用混在一起
if (!app.isPackaged && app.getName() === 'Electron' && !app.commandLine.hasSwitch('user-data-dir')) {
  app.setName('whatevertools')
  app.setPath('userData', path.join(app.getPath('appData'), 'whatevertools'))
}

function readConfig(): AppConfig {
  // 开发时 argv 里有 electron 本身和应用目录（或本文件），打包后只有可执行文件
  const self = new Set([path.resolve(app.getAppPath()), __filename, __filename.replace(/\.js$/, '')])
  const argv = process.argv.slice(1).filter((a) => !self.has(path.resolve(a)) && !/[\\/]electron(\.exe)?$/i.test(a))
  let file: string | undefined
  const dirs: string[] = []
  const flags: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--config') file = argv[++i]
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      flags[k] = v ?? 'true'
    } else if (!a.startsWith('-') && a !== '.') dirs.push(path.resolve(a))
  }
  const defaultFile = path.join(os.homedir(), '.whatevertools', 'config.json')
  const cfgFile = file ?? (fs.existsSync(defaultFile) ? defaultFile : undefined)
  let base: Partial<AppConfig> = {}
  // 指定的文件还不存在时按默认配置启动，设置页以后会写进去
  if (cfgFile && fs.existsSync(cfgFile)) {
    try {
      base = JSON.parse(fs.readFileSync(cfgFile, 'utf8'))
    } catch (e) {
      const msg = `${cfgFile}\n\n${(e as Error).message}\n\n将使用默认配置启动。`
      if (process.env.WHATEVERTOOLS_HEADLESS) console.error('[whatevertools] 配置文件有误：' + msg)
      else require('electron').dialog.showErrorBox('配置文件有误', msg)
    }
  }
  const rel = (p: string) => (cfgFile ? path.resolve(path.dirname(cfgFile), p) : path.resolve(p))
  return {
    mode: 'launcher',
    compat: [{ type: 'utools' }],
    mcp: { enabled: true },
    ...base,
    plugins: [...(base.plugins ?? []).map(rel), ...dirs],
    devPlugins: flags.dev ? 'all' : base.devPlugins,
    // 设置页里添加 / 移除插件目录时写回这个文件
    configFile: cfgFile ?? defaultFile,
    identity: { host: { name: 'whatevertools-launcher', version: app.getVersion() }, ...base.identity },
  } as AppConfig
}

runApp(readConfig()).catch((e) => {
  console.error(e)
  app.exit(1)
})
