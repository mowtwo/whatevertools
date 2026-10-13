#!/usr/bin/env node
// whatevertools 命令行
//   whatevertools run <插件目录...> [--dev]                         在裸 Electron 启动器里运行
//   whatevertools check <插件目录> [--name whatevertools]                   兼容报告
//   whatevertools pack <插件目录或插件包...> --target utools|electron|web
//        多个插件：electron 打成一个启动器应用，web 打成带入口页的站点（需要 --product）
//        [--allow-install] [--max-plugins <n>] [--app-version <版本>]
//        [--name <注入名/底座名>] [--package <包名>] [--product <应用名>] [--compat utools[:别名]|none]
//        [--host-name <宿主名>] [--host-version <宿主版本>] [--mock-platform uTools] [--mock-version 7.0.0] [--out <目录>]
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pack, type Target } from './pack'
import { printReport, scanUsage } from './report'

/** 不带值的开关 */
const BOOLEAN_FLAGS = new Set(['dev', 'help', 'allow-install'])

function parse(argv: string[]) {
  const args: string[] = []
  const flags: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      if (v !== undefined) flags[k] = v
      else if (BOOLEAN_FLAGS.has(k)) flags[k] = 'true'
      else flags[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'
    } else args.push(a)
  }
  return { args, flags }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const { args, flags } = parse(rest)
  switch (cmd) {
    case 'pack': {
      if (!args[0]) throw new Error('用法：whatevertools pack <插件目录或插件包...> --target utools|electron|web')
      const target = (flags.target ?? 'utools') as Target
      if (!['utools', 'electron', 'web'].includes(target)) throw new Error(`--target 只能是 utools / electron / web`)
      await pack({
        dir: args.length > 1 ? args : args[0], target, appVersion: flags['app-version'],
        install: flags['allow-install'] || flags['max-plugins'] ? { enabled: true, ...(flags['max-plugins'] ? { max: Number(flags['max-plugins']) } : {}) } : undefined, out: flags.out, name: flags.name, packageName: flags.package, productName: flags.product,
        compat: flags.compat, hostName: flags['host-name'], hostVersion: flags['host-version'],
        mockPlatform: flags['mock-platform'], mockVersion: flags['mock-version'],
      })
      break
    }
    case 'check': {
      if (!args[0]) throw new Error('用法：whatevertools check <插件目录>')
      const r = scanUsage(path.resolve(args[0]), flags.name ?? 'whatevertools')
      for (const t of ['electron', 'web'] as const) console.log(`\n[${t}]\n${printReport(r, t)}`)
      break
    }
    case 'run': {
      const electron = require('electron') as unknown as string
      const launcher = path.join(__dirname, 'launcher.js')
      // 参数原样交给启动器（--config、--dev 以及 --user-data-dir=… 这类 Electron 开关），路径转成绝对路径
      const passthrough = rest.map((a) => (a.startsWith('-') ? a : path.resolve(a)))
      const child = spawn(electron, [launcher, ...passthrough], { stdio: 'inherit' })
      child.on('exit', (code) => process.exit(code ?? 0))
      break
    }
    default:
      console.log('用法：whatevertools <run|check|pack> ...（见源码顶部说明）')
      process.exit(cmd ? 1 : 0)
  }
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})
