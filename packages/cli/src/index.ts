#!/usr/bin/env node
// whatevertools 命令行（简写 wt）。全部非交互；--json 输出机器可读的结果；退出码：0 成功，1 失败，2 用法或配置错误
//   whatevertools build [--config <文件>] [--target utools,electron,web] [--binary] [--platform mac,win,linux] [--json]
//        按 whatevertools.config.{ts,mjs,cjs,json} 打包；--binary 让 electron 目标继续出安装包（签名、公证凭据走环境变量）
//   whatevertools doctor [--config <文件>] [--target electron] [--binary] [--platform …] [--json]   检查构建环境和签名凭据
//   whatevertools init [--ci github] [--force]                       生成配置文件（和 CI 模板）
//   whatevertools skill [--dir .claude/skills] [--force]             把给 AI Agent 用的 skill 装进项目
//   whatevertools run <插件目录或插件包...> [--dev] [--config <启动器配置>]   在裸 Electron 启动器里运行
//   whatevertools check <插件目录> [--name whatevertools] [--json]    兼容报告
//   whatevertools pack <插件目录或插件包...> --target utools|electron|web    不用配置文件、直接打包
//        多个插件：electron 打成一个启动器应用，web 打成带入口页的站点（需要 --product）
//        [--allow-install] [--max-plugins <n>] [--app-version <版本>]
//        [--name <注入名/底座名>] [--package <包名>] [--product <应用名>] [--compat utools[:别名]|none]
//        [--host-name <宿主名>] [--host-version <宿主版本>] [--mock-platform uTools] [--mock-version 7.0.0] [--out <目录>]
// 环境变量：WT_CONFIG（配置文件）、WT_TARGET（目标，逗号分隔）
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pack, type Target } from './pack'
import { printReport, scanUsage } from './report'
import { ConfigError, findConfig, loadConfig, resolveTargets, type Platform } from './config'
import { build } from './build'
import { doctor, printDoctor } from './doctor'
import { init } from './init'
import { hostPlatform } from './signing'

/** 不带值的开关 */
const BOOLEAN_FLAGS = new Set(['dev', 'help', 'allow-install', 'json', 'binary', 'force'])

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

class UsageError extends Error {}

/** 原始的 stdout（--json 模式下 process.stdout.write 被转到 stderr） */
const stdoutWrite = process.stdout.write.bind(process.stdout)

function platformsOf(flag: string | undefined): Platform[] {
  if (!flag) return [hostPlatform()]
  const list = flag.split(',').map((s) => s.trim()) as Platform[]
  for (const p of list) if (!['mac', 'win', 'linux'].includes(p)) throw new UsageError(`--platform 只能是 mac / win / linux：${p}`)
  return list
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const { args, flags } = parse(rest)
  const json = flags.json === 'true'
  // --json 时 stdout 只有最后一行结果：所有日志（包括 electron-builder 等第三方工具写到 stdout 的）都转到 stderr
  if (json) process.stdout.write = ((chunk: any, ...rest: any[]) => (process.stderr.write as any)(chunk, ...rest)) as typeof process.stdout.write
  const log = json ? (s: string) => process.stderr.write(s + '\n') : (s: string) => console.log(s)
  const result = (data: unknown, text?: string) => (json ? stdoutWrite(JSON.stringify({ ok: true, ...(data as object) }) + '\n') : text && console.log(text))
  const cwd = process.cwd()

  switch (cmd) {
    case 'build': {
      const file = findConfig(cwd, flags.config)
      if (!file) throw new ConfigError('没有找到 whatevertools.config.{ts,mjs,cjs,json}（运行 whatevertools init 生成，或用 --config 指定）')
      const config = await loadConfig(file)
      const targets = resolveTargets(flags.target, config)
      const results = await build({ config, root: path.dirname(file), targets, binary: flags.binary === 'true' ? true : undefined, platforms: flags.platform ? platformsOf(flags.platform) : undefined, log })
      result({ config: file, results }, `\n完成：${results.map((r) => `${r.target} → ${r.out}${r.binaries ? `（安装包 ${r.binaries.flatMap((b) => b.artifacts).length} 个）` : ''}`).join('；')}`)
      break
    }
    case 'doctor': {
      const file = findConfig(cwd, flags.config)
      const config = file ? await loadConfig(file) : undefined
      const binary = flags.binary === 'true' || !!config?.electron?.binary
      const r = doctor({ config, root: file ? path.dirname(file) : cwd, platforms: platformsOf(flags.platform), binary })
      if (json) stdoutWrite(JSON.stringify({ config: file, ...r }) + '\n')
      else console.log(printDoctor(r))
      if (!r.ok) process.exitCode = 1
      break
    }
    case 'init': {
      const written = init({ cwd, ci: flags.ci, force: flags.force === 'true', log })
      result({ written })
      break
    }
    case 'skill': {
      const fs = require('node:fs') as typeof import('node:fs')
      const src = path.join(__dirname, '..', 'skills', 'whatevertools')
      const dst = path.resolve(cwd, flags.dir ?? path.join('.claude', 'skills'), 'whatevertools')
      if (fs.existsSync(dst) && flags.force !== 'true') throw new UsageError(`${dst} 已存在（--force 覆盖）`)
      fs.rmSync(dst, { recursive: true, force: true })
      fs.cpSync(src, dst, { recursive: true })
      log(`已安装 skill：${dst}`)
      result({ dir: dst })
      break
    }
    case 'pack': {
      if (!args[0]) throw new UsageError('用法：whatevertools pack <插件目录或插件包...> --target utools|electron|web')
      const target = (flags.target ?? 'utools') as Target
      if (!['utools', 'electron', 'web'].includes(target)) throw new UsageError('--target 只能是 utools / electron / web')
      const r = await pack({
        dir: args.length > 1 ? args : args[0], target, appVersion: flags['app-version'],
        install: flags['allow-install'] || flags['max-plugins'] ? { enabled: true, ...(flags['max-plugins'] ? { max: Number(flags['max-plugins']) } : {}) } : undefined,
        out: flags.out, name: flags.name, packageName: flags.package, productName: flags.product,
        compat: flags.compat, hostName: flags['host-name'], hostVersion: flags['host-version'],
        mockPlatform: flags['mock-platform'], mockVersion: flags['mock-version'], log,
      })
      result({ target, out: r.out })
      break
    }
    case 'check': {
      if (!args[0]) throw new UsageError('用法：whatevertools check <插件目录>')
      const r = scanUsage(path.resolve(args[0]), flags.name ?? 'whatevertools')
      if (json) result({ usage: r })
      else for (const t of ['electron', 'web'] as const) console.log(`\n[${t}]\n${printReport(r, t)}`)
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
    case undefined:
    case 'help':
    case '--help':
      console.log('用法：whatevertools <build|doctor|init|skill|run|check|pack> …（加 --json 输出机器可读结果；详见 https://github.com/mowtwo/whatevertools）')
      break
    default:
      throw new UsageError(`不认识的命令：${cmd}（可用：build、doctor、init、skill、run、check、pack）`)
  }
}

main().catch((e) => {
  const code = e instanceof UsageError || e instanceof ConfigError ? 2 : 1
  if (process.argv.includes('--json')) stdoutWrite(JSON.stringify({ ok: false, code: e.code ?? (code === 2 ? 'EWTUSAGE' : 'EWTFAIL'), error: e.message ?? String(e) }) + '\n')
  else console.error(e.message ?? e)
  process.exit(code)
})
