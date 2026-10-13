// 错误类型：带 code，便于调用方判断

export class PackageError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'PackageError'
  }
}

/** upxs：uTools 加密签名包，不解密 */
export class EncryptedPackageError extends Error {
  readonly code = 'EWTENCRYPTED'
  constructor() {
    super('upxs 是 uTools 加密签名的安装包，只能由 uTools 安装。请向插件作者索取 upx 安装包或源代码目录。')
    this.name = 'EncryptedPackageError'
  }
}

/** 归一化归档内路径：反斜杠转正斜杠、去掉 . 段；拒绝 ..、绝对路径、盘符和 NUL */
export function normalizeEntryPath(p: string): string {
  if (typeof p !== 'string') throw new PackageError('EUNSAFEPATH', `非法路径：${String(p)}`)
  const s = p.replace(/\\/g, '/')
  if (s.startsWith('/') || /^[a-zA-Z]:/.test(s) || s.includes('\0')) throw new PackageError('EUNSAFEPATH', `不安全的路径：${p}`)
  const out: string[] = []
  for (const seg of s.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') throw new PackageError('EUNSAFEPATH', `不安全的路径：${p}`)
    out.push(seg)
  }
  if (!out.length) throw new PackageError('EUNSAFEPATH', `空路径：${p}`)
  return out.join('/')
}
