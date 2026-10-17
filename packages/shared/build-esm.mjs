// tsc 只出 CommonJS（preload 直接 require、也能单文件拷进 uTools 插件）；这里补一份 ESM 给 renderer / 打包工具
import { buildSync } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
buildSync({ entryPoints: [path.join(dir, 'src/index.ts')], outfile: path.join(dir, 'dist/index.mjs'), format: 'esm', target: 'es2020', bundle: true, platform: 'neutral', logLevel: 'warning' })
