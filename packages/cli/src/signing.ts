// 签名环境检测：只看环境变量和钥匙串是否齐全，不读取、不打印任何凭据内容
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import type { Platform, SigningConfig } from './config'

export interface SigningStatus {
  platform: Platform
  /** 会不会签名 */
  sign: boolean
  /** 签名方式说明 */
  method: string
  /** mac：会不会公证 */
  notarize?: boolean
  /** 缺什么（要签名但凭据不全时） */
  missing: string[]
  /** 提示（不影响构建） */
  notes: string[]
}

const has = (k: string) => !!process.env[k]
const all = (...ks: string[]) => ks.every(has)

/** 钥匙串里有没有 Developer ID Application 证书（只看名字，不导出） */
function keychainIdentity(): string | null {
  if (process.platform !== 'darwin') return null
  const r = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
  const m = /"(Developer ID Application:[^"]+)"/.exec(r.stdout ?? '')
  return m ? m[1] : null
}

export function macSigning(cfg: SigningConfig['mac'] = {}): SigningStatus {
  const notes: string[] = []
  const missing: string[] = []
  if (cfg.identity === false) return { platform: 'mac', sign: false, method: '配置里关闭了签名', notarize: false, missing, notes: ['未签名的应用在其他 Mac 上会被 Gatekeeper 拦截，用户需要右键打开'] }
  let method = ''
  if (has('CSC_LINK')) {
    method = 'CSC_LINK 证书文件'
    if (!has('CSC_KEY_PASSWORD')) missing.push('CSC_KEY_PASSWORD（证书密码）')
  } else if (cfg.identity) method = `钥匙串身份：${cfg.identity}`
  else {
    const id = keychainIdentity()
    if (id) method = `钥匙串身份：${id}`
  }
  const sign = !!method
  if (!sign) notes.push('没有找到 Developer ID 证书（CSC_LINK + CSC_KEY_PASSWORD，或钥匙串里的 Developer ID Application），将不签名')
  const apiKey = all('APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER')
  const appleId = all('APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID')
  const keychainProfile = has('APPLE_KEYCHAIN_PROFILE')
  let notarize = cfg.notarize ?? (sign && (apiKey || appleId || keychainProfile))
  if (notarize && !(apiKey || appleId || keychainProfile)) {
    missing.push('公证凭据：APPLE_API_KEY（.p8 文件路径）+ APPLE_API_KEY_ID + APPLE_API_ISSUER，或 APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID，或 APPLE_KEYCHAIN_PROFILE')
  }
  if (notarize && !sign) {
    missing.push('公证需要先签名')
    notarize = false
  }
  if (has('APPLE_API_KEY') && !fs.existsSync(process.env.APPLE_API_KEY!)) missing.push('APPLE_API_KEY 应该是 .p8 文件的路径（CI 里先把 secret 写成文件）')
  if (sign && !notarize) notes.push('签名但不公证：macOS 10.15 以后从网上下载的应用仍会提示无法验证开发者')
  return { platform: 'mac', sign, method: method || '不签名', notarize: !!notarize, missing, notes }
}

export function winSigning(cfg: SigningConfig['win'] = {}): SigningStatus {
  const missing: string[] = []
  const notes: string[] = []
  const pfx = has('WIN_CSC_LINK') || has('CSC_LINK')
  const azureEnv = all('AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET')
  const mode = cfg.mode ?? (cfg.azure && azureEnv ? 'azure' : pfx ? 'pfx' : 'none')
  if (mode === 'none') {
    notes.push('不签名：SmartScreen 会提示「未知发布者」')
    return { platform: 'win', sign: false, method: '不签名', missing, notes }
  }
  if (mode === 'pfx') {
    if (!pfx) missing.push('WIN_CSC_LINK 或 CSC_LINK（.pfx 证书的路径或 base64）')
    if (!has('WIN_CSC_KEY_PASSWORD') && !has('CSC_KEY_PASSWORD')) missing.push('WIN_CSC_KEY_PASSWORD 或 CSC_KEY_PASSWORD（证书密码）')
    return { platform: 'win', sign: true, method: 'pfx 证书', missing, notes }
  }
  if (!cfg.azure) missing.push('配置 electron.sign.win.azure（endpoint、certificateProfileName、codeSigningAccountName）')
  for (const k of ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET']) if (!has(k)) missing.push(k)
  if (process.platform !== 'win32') notes.push('Azure Trusted Signing 需要在 Windows 上构建')
  return { platform: 'win', sign: true, method: 'Azure Trusted Signing', missing, notes }
}

export function linuxSigning(): SigningStatus {
  return { platform: 'linux', sign: false, method: 'Linux 安装包不需要代码签名', missing: [], notes: [] }
}

export function signingStatus(p: Platform, cfg: SigningConfig = {}): SigningStatus {
  return p === 'mac' ? macSigning(cfg.mac) : p === 'win' ? winSigning(cfg.win) : linuxSigning()
}

export function hostPlatform(): Platform {
  return process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'
}
