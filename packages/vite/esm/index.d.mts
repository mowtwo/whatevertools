import type { WhateverToolsPluginOptions } from '../dist/index.js'
import type { Plugin } from 'vite'

declare function whatevertools(options?: WhateverToolsPluginOptions): Plugin
export default whatevertools
export { whatevertools }
export type { WhateverToolsPluginOptions }
