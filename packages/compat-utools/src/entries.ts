// uTools 的 6 种入口类型：text（功能指令）、regex、over、img、files、window。
// 宿主默认注册它们；可以通过 entry:register hook 替换或拒绝，也可以只注册其中一部分。
import { parseRegexLiteral, scoreText, type EntryType } from '@whatevertools/core'
import { pinyin } from 'pinyin-pro'

export interface MatchFile { isFile: boolean; isDirectory: boolean; name: string; path: string }
export interface MatchWindow { id: number; title: string; x: number; y: number; width: number; height: number; appPath: string; pid: number; app: string }

/** 匹配一切的正则按 uTools 规则忽略 */
function usefulRegex(literal: unknown): RegExp | null {
  if (typeof literal !== 'string') return null
  const re = parseRegexLiteral(literal)
  if (!re) return null
  if (re.test('') && re.test('\u0001any thing \n 123')) return null
  return re
}

const within = (n: number, min?: unknown, max?: unknown) =>
  (typeof min !== 'number' || n >= min) && (typeof max !== 'number' || n <= max)

/** 插件写的正则在主进程里随每次输入执行：限制输入长度，降低灾难性回溯把宿主卡死的风险 */
export const REGEX_INPUT_LIMIT = 10000
const text = (input: Record<string, unknown>) => (typeof input.text === 'string' ? input.text : '')
const regexCache = new Map<string, RegExp | null>()
function cachedRegex(literal: unknown) {
  if (typeof literal !== 'string') return null
  if (!regexCache.has(literal)) regexCache.set(literal, usefulRegex(literal))
  return regexCache.get(literal)!
}

/** 中文指令的拼音（全拼和首字母），uTools 自动支持拼音搜索 */
const pinyinCache = new Map<string, { full: string; initials: string } | null>()
function pinyinOf(label: string) {
  if (!/[\u4e00-\u9fff]/.test(label)) return null
  let v = pinyinCache.get(label)
  if (v === undefined) {
    try {
      const full = pinyin(label, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('').toLowerCase().replace(/\s+/g, '')
      const initials = pinyin(label, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('').toLowerCase().replace(/\s+/g, '')
      v = { full, initials }
    } catch {
      v = null
    }
    if (pinyinCache.size > 5000) pinyinCache.clear()
    pinyinCache.set(label, v)
  }
  return v
}

/** 拼音打分：首字母 / 全拼的前缀、包含 */
export function scorePinyin(query: string, label: string): number {
  const q = query.trim().toLowerCase()
  if (!q || !/^[a-z]+$/.test(q)) return 0
  const py = pinyinOf(label)
  if (!py) return 0
  if (py.initials === q || py.full === q) return 0.95
  if (py.initials.startsWith(q) || py.full.startsWith(q)) return 0.8
  if (py.initials.includes(q) || py.full.includes(q)) return 0.55
  return 0
}

export const utoolsEntryTypes: EntryType[] = [
  {
    type: 'text',
    handlesString: true,
    match(cmd, input, ctx) {
      const q = text(input)
      if (!q || input.files || input.image) return null
      const s = Math.max(scoreText(q, cmd.label), scorePinyin(q, cmd.label), ctx.textScorer?.(q, cmd.label) ?? 0)
      return s > 0 ? { payload: cmd.label, score: 100 * s } : null
    },
  },
  {
    type: 'regex',
    validate: (cmd) => (usefulRegex(cmd.match) ? null : `regex「${cmd.label}」的 match 不是有效的正则或会匹配一切`),
    match(cmd, input) {
      const q = text(input)
      if (!q || input.files || q.length > REGEX_INPUT_LIMIT || !within(q.length, cmd.minLength, cmd.maxLength)) return null
      const re = cachedRegex(cmd.match)
      return re && re.test(q) ? { payload: q, score: 60 } : null
    },
  },
  {
    type: 'over',
    match(cmd, input) {
      const q = text(input)
      if (!q || input.files || !within(q.length, cmd.minLength ?? 1, cmd.maxLength ?? 10000)) return null
      const ex = q.length <= REGEX_INPUT_LIMIT ? cachedRegex(cmd.exclude) : null
      if (ex && ex.test(q)) return null
      return { payload: q, score: 20 }
    },
  },
  {
    type: 'img',
    match: (_cmd, input) => (typeof input.image === 'string' ? { payload: input.image, score: 60 } : null),
  },
  {
    type: 'files',
    match(cmd, input) {
      const files = input.files as MatchFile[] | undefined
      if (!Array.isArray(files) || !files.length || !within(files.length, cmd.minLength, cmd.maxLength)) return null
      const re = typeof cmd.match === 'string' ? parseRegexLiteral(cmd.match) : null
      const exts = Array.isArray(cmd.extensions) ? (cmd.extensions as string[]).map((e) => e.toLowerCase().replace(/^\./, '')) : null
      const ok = files.every((f) => {
        if (cmd.fileType === 'file' && !f.isFile) return false
        if (cmd.fileType === 'directory' && !f.isDirectory) return false
        if (exts?.length) {
          const ext = f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : ''
          if (!exts.includes(ext)) return false
        }
        return !re || re.test(f.name)
      })
      return ok ? { payload: files, score: 60 } : null
    },
  },
  {
    type: 'window',
    match(cmd, input) {
      const win = input.window as MatchWindow | undefined
      const m = cmd.match as { app?: string[]; title?: string } | undefined
      if (!win || !m?.app?.some((a) => a.toLowerCase() === String(win.app).toLowerCase())) return null
      if (m.title) {
        const re = parseRegexLiteral(m.title)
        if (re && !re.test(win.title)) return null
      }
      return { payload: win, score: 40 }
    },
  },
]

/** 把 uTools 入口类型注册到一个 EntryRegistry，返回取消注册的函数 */
export function registerUtoolsEntries(registry: { register(t: EntryType): () => void }, only?: string[]): () => void {
  const offs = utoolsEntryTypes.filter((t) => !only || only.includes(t.type)).map((t) => registry.register(t))
  return () => offs.forEach((f) => f())
}
