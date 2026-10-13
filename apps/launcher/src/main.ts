// 启动器：electron apps/launcher [--config whatevertools.config.json] [插件目录...]
// 配置文件字段见 AppConfig（@whatevertools/electron）；命令行给的插件目录会追加到配置里。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { runApp, type AppConfig } from '@whatevertools/electron'

function readConfig(): AppConfig {
  // 开发时 argv 里有 electron 本身和应用目录，打包后只有可执行文件
  const appPath = path.resolve(app.getAppPath())
  const argv = process.argv.slice(1).filter((a) => path.resolve(a) !== appPath && !/[\\/]electron(\.exe)?$/i.test(a))
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
  if (cfgFile) {
    try {
      base = JSON.parse(fs.readFileSync(cfgFile, 'utf8'))
    } catch (e) {
      require('electron').dialog.showErrorBox('配置文件有误', `${cfgFile}\n\n${(e as Error).message}\n\n将使用默认配置启动。`)
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
