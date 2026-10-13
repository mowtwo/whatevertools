// 剪贴板后端：Electron 43 及以前是同步 API（readImage / writeBuffer ...），44 起换成了 Web 标准的异步 API
// （read / write / ClipboardItem）。这里统一成一套异步接口，启动时自动选择实现。
import { clipboard as rawClipboard, nativeImage, type NativeImage } from 'electron'

export interface ClipboardBackend {
  readonly kind: 'legacy' | 'modern'
  readText(): Promise<string>
  writeText(text: string): Promise<void>
  readHTML(): Promise<string>
  writeHTML(html: string): Promise<void>
  readImage(): Promise<NativeImage>
  writeImage(img: NativeImage): Promise<void>
  /** 平台原生格式（如 NSFilenamesPboardType / CF_HDROP），modern 后端可能不支持 */
  readBuffer(format: string): Promise<Buffer>
  writeBuffer(format: string, data: Buffer): Promise<void>
  formats(): Promise<string[]>
  has(format: string): Promise<boolean>
  clear(): Promise<void>
  /** 是否支持原生格式读写（决定文件复制能否实现） */
  readonly nativeFormats: boolean
}

const legacy = rawClipboard as any

function legacyBackend(): ClipboardBackend {
  return {
    kind: 'legacy',
    nativeFormats: true,
    readText: async () => legacy.readText(),
    writeText: async (t) => legacy.writeText(t),
    readHTML: async () => legacy.readHTML(),
    writeHTML: async (h) => legacy.writeHTML(h),
    readImage: async () => legacy.readImage(),
    writeImage: async (img) => legacy.writeImage(img),
    readBuffer: async (f) => legacy.readBuffer(f),
    writeBuffer: async (f, d) => legacy.writeBuffer(f, d),
    formats: async () => legacy.availableFormats(),
    has: async (f) => legacy.has(f),
    clear: async () => legacy.clear(),
  }
}

function modernBackend(): ClipboardBackend {
  const c = rawClipboard as any
  const Item = (require('electron') as any).ClipboardItem
  const items = async (): Promise<any[]> => {
    try {
      return await c.read()
    } catch {
      return []
    }
  }
  const findType = async (mime: string) => {
    for (const it of await items()) if (it.types?.includes(mime)) return it.getType(mime)
    return null
  }
  const blobBytes = async (b: any) => Buffer.from(await b.arrayBuffer())
  const write = async (record: Record<string, Blob | string>) => c.write([new Item(record)])
  return {
    kind: 'modern',
    nativeFormats: false,
    readText: () => c.readText(),
    writeText: (t) => c.writeText(t),
    readHTML: async () => {
      const b = await findType('text/html')
      return b ? (typeof b === 'string' ? b : await b.text()) : ''
    },
    writeHTML: (h) => write({ 'text/html': new Blob([h], { type: 'text/html' }) }),
    readImage: async () => {
      const b = await findType('image/png')
      return b ? nativeImage.createFromBuffer(await blobBytes(b)) : nativeImage.createEmpty()
    },
    writeImage: (img) => write({ 'image/png': new Blob([new Uint8Array(img.toPNG())], { type: 'image/png' }) }),
    // 只支持 Web 自定义格式（web 前缀）；系统原生格式在新 API 里拿不到
    readBuffer: async (f) => {
      const b = await findType(f.startsWith('web ') ? f : `web ${f}`)
      return b ? await blobBytes(b) : Buffer.alloc(0)
    },
    writeBuffer: (f, d) => write({ [f.startsWith('web ') ? f : `web ${f}`]: new Blob([new Uint8Array(d)]) }),
    formats: async () => (await items()).flatMap((it) => it.types ?? []),
    has: (f) => c.has(f),
    clear: async () => c.clear(),
  }
}

let backend: ClipboardBackend | null = null

export function clipboardBackend(): ClipboardBackend {
  if (!backend) backend = typeof legacy.readImage === 'function' ? legacyBackend() : modernBackend()
  return backend
}

/** 给插件的 require('electron').clipboard（旧同步形状）用：方法名 → 实现 */
export async function legacyClipboardCall(method: string, args: any[]): Promise<unknown> {
  const b = clipboardBackend()
  switch (method) {
    case 'readText': return b.readText()
    case 'writeText': return b.writeText(String(args[0] ?? ''))
    case 'readHTML': return b.readHTML()
    case 'writeHTML': return b.writeHTML(String(args[0] ?? ''))
    case 'readImage': {
      const img = await b.readImage()
      return { png: new Uint8Array(img.toPNG()), ...img.getSize() }
    }
    case 'writeImage': return b.writeImage(nativeImage.createFromBuffer(Buffer.from(args[0])))
    case 'readBuffer': return new Uint8Array(await b.readBuffer(String(args[0])))
    case 'writeBuffer': return b.writeBuffer(String(args[0]), Buffer.from(args[1]))
    case 'read': return (await b.readBuffer(String(args[0]))).toString('utf8')
    case 'availableFormats': return b.formats()
    case 'has': return b.has(String(args[0]))
    case 'clear': return b.clear()
    case 'write': {
      const d = args[0] ?? {}
      if (d.text !== undefined) await b.writeText(String(d.text))
      if (d.html !== undefined) await b.writeHTML(String(d.html))
      if (d.image) await b.writeImage(nativeImage.createFromBuffer(Buffer.from(d.image)))
      return
    }
    default:
      throw Object.assign(new Error(`[whatevertools] clipboard.${method} 不支持`), { code: 'EWTUNSUPPORTED' })
  }
}
