// 极简 semver：只支持 x.y.z（可带 -pre），范围支持 ^ ~ >= > <= < = x 通配和空格分隔的 AND、|| 分隔的 OR
export type Version = [number, number, number, string]

export function parseVersion(v: string): Version | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/.exec(String(v).trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0), m[4] ?? '']
}

export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) throw new Error(`invalid version: ${!x ? a : b}`)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number)
  if (x[3] === y[3]) return 0
  if (!x[3]) return 1
  if (!y[3]) return -1
  return x[3] < y[3] ? -1 : 1
}

function comparator(c: string, v: string): boolean {
  const m = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(c)
  if (!m) return false
  const op = m[1] ?? '='
  let target = m[2]
  if (target === '*' || target === 'x') return true
  // 1.x / 1.2.x / 1 / 1.2 → 范围
  const parts = target.split('.')
  const wild = parts.findIndex((p) => p === 'x' || p === '*')
  if ((wild >= 0 || parts.length < 3) && op === '=') {
    const fixed = (wild >= 0 ? parts.slice(0, wild) : parts).map(Number)
    const pv = parseVersion(v)
    if (!pv) return false
    return fixed.every((n, i) => pv[i] === n)
  }
  target = parts.map((p) => (p === 'x' || p === '*' ? '0' : p)).join('.')
  const t = parseVersion(target)
  const pv = parseVersion(v)
  if (!t || !pv) return false
  const cmp = compareVersions(v, target)
  switch (op) {
    case '>=': return cmp >= 0
    case '<=': return cmp <= 0
    case '>': return cmp > 0
    case '<': return cmp < 0
    case '=': return cmp === 0
    case '~': return cmp >= 0 && pv[0] === t[0] && pv[1] === t[1]
    case '^':
      if (cmp < 0) return false
      if (t[0] > 0) return pv[0] === t[0]
      if (t[1] > 0) return pv[0] === 0 && pv[1] === t[1]
      return pv[0] === 0 && pv[1] === 0 && pv[2] === t[2]
  }
  return false
}

export function satisfies(version: string, range: string): boolean {
  if (!range || range.trim() === '*') return true
  return range.split('||').some((set) =>
    set.trim().replace(/(\^|~|>=|<=|>|<|=)\s+/g, '$1').split(/\s+/).filter(Boolean).every((c) => comparator(c, version)),
  )
}
