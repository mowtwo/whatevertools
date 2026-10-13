// ESM 入口：vite.config.ts 里 import whatevertools from '@whatevertools/vite' 走这里
import plugin from '../dist/index.js'

export default plugin
export const whatevertools = plugin
