// POSIX path（浏览器端没有 Windows 路径）
function normalizeArray(parts: string[], allowAbove: boolean) {
  const res: string[] = []
  for (const p of parts) {
    if (!p || p === '.') continue
    if (p === '..') {
      if (res.length && res[res.length - 1] !== '..') res.pop()
      else if (allowAbove) res.push('..')
    } else res.push(p)
  }
  return res
}

export function createPath(cwd: () => string) {
  const path: any = {
    sep: '/',
    delimiter: ':',
    isAbsolute: (p: string) => p.startsWith('/'),
    normalize(p: string) {
      const abs = p.startsWith('/')
      const trail = p.endsWith('/')
      let out = normalizeArray(p.split('/'), !abs).join('/')
      if (!out && !abs) out = '.'
      if (out && trail) out += '/'
      return (abs ? '/' : '') + out
    },
    join: (...ps: string[]) => path.normalize(ps.filter(Boolean).join('/') || '.'),
    resolve(...ps: string[]) {
      let r = ''
      for (let i = ps.length - 1; i >= 0 && !r.startsWith('/'); i--) if (ps[i]) r = ps[i] + (r ? '/' + r : '')
      if (!r.startsWith('/')) r = cwd() + (r ? '/' + r : '')
      return '/' + normalizeArray(r.split('/'), false).join('/')
    },
    relative(from: string, to: string) {
      const a = path.resolve(from).split('/').filter(Boolean)
      const b = path.resolve(to).split('/').filter(Boolean)
      let i = 0
      while (i < a.length && i < b.length && a[i] === b[i]) i++
      return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/')
    },
    dirname(p: string) {
      if (p === '/' || /^\/+$/.test(p)) return '/'
      const s = p.replace(/\/+$/, '')
      const i = s.lastIndexOf('/')
      return i < 0 ? '.' : i === 0 ? '/' : s.slice(0, i)
    },
    basename(p: string, ext?: string) {
      const b = p.replace(/\/+$/, '').split('/').pop() ?? ''
      return ext && b.endsWith(ext) && b !== ext ? b.slice(0, -ext.length) : b
    },
    extname(p: string) {
      const b = path.basename(p)
      const i = b.lastIndexOf('.')
      return i <= 0 ? '' : b.slice(i)
    },
    parse(p: string) {
      const root = p.startsWith('/') ? '/' : ''
      const b = path.basename(p)
      const ext = path.extname(p)
      return { root, dir: path.dirname(p), base: b, ext, name: ext ? b.slice(0, -ext.length) : b }
    },
    format: (o: { dir?: string; root?: string; base?: string; name?: string; ext?: string }) => (o.dir || o.root || '') + (o.dir ? '/' : '') + (o.base || (o.name ?? '') + (o.ext ?? '')),
    toNamespacedPath: (p: string) => p,
  }
  path.posix = path
  path.win32 = path
  return path
}
