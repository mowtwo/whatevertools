// whatevertools doctor：检查构建环境（Node、Electron、electron-builder、各平台签名凭据）。不读取、不输出凭据内容
import fs from 'node:fs'
import path from 'node:path'
import type { Platform, WhateverToolsConfig } from './config'
import { resolveElectronBuilder } from './binary'
import { signingStatus, type SigningStatus } from './signing'

export interface DoctorCheck {
  name: string
  ok: boolean
  /** 失败时是否阻止构建 */
  required: boolean
  detail: string
}

export interface DoctorReport {
  ok: boolean
  checks: DoctorCheck[]
  signing: SigningStatus[]
}

export function doctor(o: { config?: WhateverToolsConfig; root: string; platforms: Platform[]; binary: boolean }): DoctorReport {
  const checks: DoctorCheck[] = []
  const major = Number(process.versions.node.split('.')[0])
  checks.push({ name: 'Node.js', ok: major >= 20, required: true, detail: `v${process.versions.node}${major >= 20 ? '' : '（需要 20 以上）'}` })
  if (o.config) {
    for (const p of Array.isArray(o.config.plugins) ? o.config.plugins : [o.config.plugins]) {
      const abs = path.resolve(o.root, p)
      checks.push({ name: `插件 ${p}`, ok: fs.existsSync(abs), required: true, detail: fs.existsSync(abs) ? abs : `不存在：${abs}` })
    }
  }
  let electron = ''
  try {
    electron = JSON.parse(fs.readFileSync(require.resolve('electron/package.json', { paths: [process.cwd(), __dirname] }), 'utf8')).version
  } catch {}
  checks.push({ name: 'Electron', ok: !!electron, required: false, detail: electron ? `v${electron}` : '没装（wt run 需要；打包会按 43.x 写进应用的 package.json）' })
  const eb = resolveElectronBuilder(process.cwd())
  let ebVersion = ''
  if (eb) {
    try {
      ebVersion = JSON.parse(fs.readFileSync(path.join(eb.slice(0, eb.lastIndexOf('node_modules') + 'node_modules'.length), 'electron-builder', 'package.json'), 'utf8')).version
    } catch {}
  }
  checks.push({ name: 'electron-builder', ok: !!eb, required: o.binary, detail: eb ? `v${ebVersion || '?'}` : '没装：出安装包需要 npm i -D electron-builder' })
  const signing = o.platforms.map((p) => signingStatus(p, o.config?.electron?.sign))
  for (const s of signing) {
    checks.push({ name: `签名（${s.platform}）`, ok: s.missing.length === 0, required: o.binary, detail: s.missing.length ? `缺少：${s.missing.join('；')}` : `${s.method}${s.platform === 'mac' ? (s.notarize ? '，会公证' : '，不公证') : ''}` })
  }
  return { ok: checks.every((c) => c.ok || !c.required), checks, signing }
}

export function printDoctor(r: DoctorReport): string {
  const lines = r.checks.map((c) => `${c.ok ? '✔' : c.required ? '✖' : '!'} ${c.name}：${c.detail}`)
  for (const s of r.signing) for (const n of s.notes) lines.push(`  · ${s.platform}：${n}`)
  lines.push(r.ok ? '\n环境可以构建' : '\n有必需项没通过（✖）')
  return lines.join('\n')
}
