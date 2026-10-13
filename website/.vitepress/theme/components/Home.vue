<script setup lang="ts">
import { ref } from 'vue'

const tabs = [
  {
    id: 'electron',
    label: '给 Electron 应用加插件',
    file: 'main.ts',
    code: `import { runApp } from '@whatevertools/electron'

runApp({
  mode: 'launcher',
  plugins: ['./plugins/translate', './downloads/ocr.upx'],
  compat: [{ type: 'utools' }],          // 现有 uTools 插件直接跑
  install: { enabled: true, max: 20 },   // 用户还能自己装插件包
  policy: { plugins: { ocr: { 'fs.read': ['~/Pictures'] } } },
  providers: { ai: { complete: callMyModel } },
})`,
  },
  {
    id: 'web',
    label: '给网站加插件',
    file: 'app.ts',
    code: `import { createWebHost } from '@whatevertools/web-host'

const host = createWebHost({
  swUrl: '/__wt/sw.js',
  runtimeUrl: '/wt-runtime.js',
  policy: { max: 5, deny: ['untrusted-*'] },
  container: document.querySelector('#plugins'),
})

await host.ready
const plugin = await host.install(fileInput.files[0])   // .upx / .asar / .zip
host.open(plugin.id)                                    // 每个插件一个 iframe`,
  },
  {
    id: 'build',
    label: '一次打包三端',
    file: 'whatevertools.config.ts',
    code: `import { defineConfig } from '@whatevertools/cli'

export default defineConfig({
  plugins: './dist',
  targets: ['utools', 'electron', 'web'],
  name: 'acme',                      // window.acme
  electron: {
    binary: { formats: { mac: ['dmg'], win: ['nsis'], linux: ['AppImage'] } },
    // 证书只从环境变量读：CSC_LINK、APPLE_API_KEY…
  },
})

// $ npx whatevertools build --binary --json`,
  },
]
const active = ref(tabs[0].id)

const features = [
  { t: '访问器级 hook', d: '注入给插件的每个函数和属性都能拦截 get / set / apply / construct；入口、窗口、权限、安装也都有 hook 点。' },
  { t: 'Chrome 式权限', d: '默认询问，按插件、按路径或域名单独授权。「始终允许 / 仅本次 / 禁止」，连续拒绝自动转禁止。' },
  { t: '版本与身份注入', d: '底座版本、宿主版本、伪装平台名和插件版本都能注入，旧插件看到的还是它熟悉的平台。' },
  { t: '适配器分层', d: 'Canvas 版 sharp、文件对话框与下载、虚拟文件系统、本地 bridge……每个兼容实现都是可替换的独立包。' },
  { t: '签名、公证、CI', d: 'electron-builder 出 dmg / nsis / AppImage，mac 公证、Windows Azure 签名，凭据只走环境变量，附 GitHub Actions 模板。' },
  { t: 'Vite 插件', d: 'vite build 直接产出三端；vite dev 在浏览器里模拟插件环境，不开 uTools 也能调界面。' },
  { t: '109 个 API 支持度透明', d: '每个 API 在 Electron 和网页上是原生、模拟还是不支持，一张表说清楚，运行时还能 supports() 查询。' },
  { t: '为 AI Agent 准备', d: '附带 Agent skill 和 llms.txt，让 Claude 之类的 Agent 直接帮你写插件、移植和打包。' },
]
</script>

<template>
  <div class="wt">
    <section class="hero">
      <div class="hero-text">
        <p class="eyebrow">开源 · MIT · @whatevertools/*</p>
        <h1>插件，<span class="grad">随便跑在哪。</span></h1>
        <p class="lead">
          把 uTools 风格的插件带到 Electron 应用、网站和你自己的平台。<br class="br" />
          一套代码三种产物；任何宿主几行代码就能接入插件生态。
        </p>
        <div class="cta">
          <a class="btn primary" href="/guide/getting-started">快速开始</a>
          <a class="btn" href="/demo/quick-union-image/index.html" target="_blank">在线试用快拼图 ↗</a>
          <a class="btn ghost" href="https://github.com/mowtwo/whatevertools" target="_blank">GitHub</a>
        </div>
        <code class="install">npm i -D @whatevertools/cli</code>
      </div>
      <div class="hero-card" aria-hidden="true">
        <div class="term-bar"><i /><i /><i /><span>~/my-plugin</span></div>
        <pre class="term"><span class="p">$</span> npx whatevertools build --binary
<span class="m">插件 快拼图（quick-union-image@1.2.0）</span>
<span class="ok">✔</span> utools   → release/utools
<span class="ok">✔</span> electron → 快拼图-1.2.0-arm64.dmg
<span class="m">  签名 · 公证：凭据来自环境变量</span>
<span class="ok">✔</span> web      → release/web/quick-union-image</pre>
      </div>
    </section>

    <section class="pillars">
      <article>
        <span class="num">01</span>
        <h3>一套插件，三种产物</h3>
        <p>同一份 plugin.json + preload + 网页：原样发布到 <b>uTools</b>，打成 <b>Electron 独立应用</b>（含签名安装包），或者打成<b>静态网页</b>。插件用 <code>targets</code> 声明自己适合哪些平台。</p>
        <a href="/guide/packaging">打包与签名 →</a>
      </article>
      <article>
        <span class="num">02</span>
        <h3>给你的应用加插件生态</h3>
        <p>Electron 应用一行 <code>runApp</code>，网站一个 <code>createWebHost</code>，就有了插件市场级的能力：动态安装、权限询问、入口与快捷键、hook 拦截、MCP 工具。</p>
        <a href="/guide/electron-host">接入宿主 →</a>
      </article>
      <article>
        <span class="num">03</span>
        <h3>upx 一键集成</h3>
        <p><b>兼容安装模式</b>：加了 SDK 的平台可以动态安装任意 upx 插件，数量、白名单都能配。<b>固定打包模式</b>：一个或几个插件直接打成一个二进制或一个网页。</p>
        <a href="/guide/packages">插件包 →</a>
      </article>
    </section>

    <section class="code">
      <div class="tabs" role="tablist">
        <button v-for="t in tabs" :key="t.id" role="tab" :aria-selected="active === t.id" :class="{ on: active === t.id }" @click="active = t.id">{{ t.label }}</button>
      </div>
      <div v-for="t in tabs" v-show="active === t.id" :key="t.id" class="code-card">
        <div class="code-file">{{ t.file }}</div>
        <pre><code>{{ t.code }}</code></pre>
      </div>
    </section>

    <section class="features">
      <h2>该有的都有</h2>
      <div class="grid">
        <div v-for="f in features" :key="f.t" class="feat">
          <h4>{{ f.t }}</h4>
          <p>{{ f.d }}</p>
        </div>
      </div>
    </section>

    <section class="cases">
      <h2>两个真实插件，两种形态</h2>
      <p class="sub">都是先在 uTools 上发布的插件，同一份代码各自打成最适合它的形态。</p>
      <div class="case-grid">
        <a class="case" href="/cases/quick-union-image">
          <img src="/cases/quick-union-image/01.jpg" alt="快拼图界面" loading="lazy" />
          <div class="case-body">
            <span class="tag web">网页</span>
            <h3>快拼图</h3>
            <p>图片拼接、网格预设、批量工作流。图片处理靠浏览器里的 Canvas 版 sharp，打开网页就能用。</p>
            <span class="more">看案例 · 在线试用 →</span>
          </div>
        </a>
        <a class="case" href="/cases/desktop-widgets">
          <img src="/cases/desktop-widgets/01.jpg" alt="桌面晾衣绳" loading="lazy" />
          <div class="case-body">
            <span class="tag desktop">Electron</span>
            <h3>桌面晾衣绳</h3>
            <p>在桌面顶部拉一根绳子挂便签、待办和文件。透明置顶、鼠标穿透这些只有桌面才做得到，所以只出 Electron 独立应用。</p>
            <span class="more">看案例 →</span>
          </div>
        </a>
      </div>
    </section>

    <section class="agents">
      <div>
        <h2>让 AI Agent 帮你写插件</h2>
        <p>官网和 npm 包都带了 Agent skill：怎么移植、哪个 API 在哪个平台能用、怎么打包签名，Agent 读完就能干活。</p>
        <a class="btn" href="/guide/agents">给 AI Agent →</a>
      </div>
      <pre class="term small"><span class="p">$</span> npx whatevertools skill
已安装 skill：.claude/skills/whatevertools

<span class="p">$</span> curl https://…/llms.txt</pre>
    </section>
  </div>
</template>

<style scoped>
.wt { --pad: clamp(16px, 4vw, 32px); max-width: 1152px; margin: 0 auto; padding: 0 var(--pad) 96px; color: var(--vp-c-text-1); }
section { margin-top: 96px; }
h2 { font-size: clamp(24px, 3.2vw, 34px); line-height: 1.2; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 12px; }
.sub { color: var(--vp-c-text-2); margin: 0 0 28px; }

.hero { margin-top: 56px; display: grid; grid-template-columns: 1.15fr 1fr; gap: 48px; align-items: center; }
.eyebrow { font-size: 13px; letter-spacing: 0.04em; color: var(--vp-c-text-2); margin: 0 0 16px; }
h1 { font-size: clamp(40px, 6vw, 66px); line-height: 1.05; font-weight: 800; letter-spacing: -0.03em; margin: 0; }
.grad { white-space: nowrap; background: var(--wt-grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
.lead { font-size: clamp(16px, 1.6vw, 19px); line-height: 1.7; color: var(--vp-c-text-2); margin: 20px 0 28px; }
.cta { display: flex; flex-wrap: wrap; gap: 12px; }
.btn { display: inline-flex; align-items: center; height: 44px; padding: 0 20px; border-radius: 999px; border: 1px solid var(--vp-c-divider); font-weight: 600; font-size: 15px; color: var(--vp-c-text-1); text-decoration: none; transition: transform 0.15s, border-color 0.15s; }
.btn:hover { transform: translateY(-1px); border-color: var(--vp-c-brand-1); }
.btn.primary { background: var(--vp-c-text-1); color: var(--vp-c-bg); border-color: transparent; }
.btn.ghost { border-color: transparent; }
.install { display: inline-block; margin-top: 24px; font-size: 14px; padding: 6px 12px; border-radius: 8px; background: var(--vp-c-bg-soft); color: var(--vp-c-text-2); }

.hero-card { border-radius: 16px; background: #15151b; box-shadow: 0 30px 80px -30px rgba(255, 61, 110, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.06); overflow: hidden; min-width: 0; }
.term-bar { display: flex; align-items: center; gap: 6px; padding: 12px 14px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
.term-bar i { width: 10px; height: 10px; border-radius: 50%; background: #3a3a44; }
.term-bar i:first-child { background: #ff5f57; }
.term-bar i:nth-child(2) { background: #febc2e; }
.term-bar i:nth-child(3) { background: #28c840; }
.term-bar span { margin-left: 8px; font-size: 12px; color: #8a8a96; }
.term { margin: 0; padding: 18px 20px 22px; font: 13px/1.85 var(--vp-font-family-mono); color: #e8e8ee; white-space: pre-wrap; word-break: break-all; }
.term .p { color: #ff7a3d; }
.term .m { color: #8a8a96; }
.term .ok { color: #4ade80; }
.term.small { border-radius: 14px; background: #15151b; font-size: 13px; }

.pillars { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.pillars article { position: relative; padding: 28px 24px 24px; border-radius: 18px; border: 1px solid var(--vp-c-divider); background: var(--vp-c-bg-soft); }
.pillars .num { font: 600 13px var(--vp-font-family-mono); color: var(--vp-c-brand-1); }
.pillars h3 { font-size: 20px; margin: 10px 0 10px; }
.pillars p { color: var(--vp-c-text-2); line-height: 1.7; margin: 0 0 16px; font-size: 15px; }
.pillars a { font-weight: 600; font-size: 14px; color: var(--vp-c-brand-1); text-decoration: none; }

.tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.tabs button { height: 36px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--vp-c-divider); font-size: 14px; color: var(--vp-c-text-2); background: transparent; cursor: pointer; }
.tabs button.on { color: var(--vp-c-bg); background: var(--vp-c-text-1); border-color: transparent; }
.code-card { border-radius: 16px; background: #15151b; overflow: hidden; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06); }
.code-file { padding: 10px 18px; font: 12px var(--vp-font-family-mono); color: #8a8a96; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
.code-card pre { margin: 0; padding: 18px 20px; overflow-x: auto; }
.code-card code { font: 13.5px/1.75 var(--vp-font-family-mono); color: #e8e8ee; white-space: pre; }

.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: var(--vp-c-divider); border: 1px solid var(--vp-c-divider); border-radius: 18px; overflow: hidden; margin-top: 24px; }
.feat { background: var(--vp-c-bg); padding: 22px 20px; }
.feat h4 { margin: 0 0 8px; font-size: 16px; }
.feat p { margin: 0; color: var(--vp-c-text-2); font-size: 14px; line-height: 1.65; }

.case-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.case { display: flex; flex-direction: column; border-radius: 18px; overflow: hidden; border: 1px solid var(--vp-c-divider); text-decoration: none; color: inherit; background: var(--vp-c-bg-soft); transition: transform 0.2s, box-shadow 0.2s; }
.case:hover { transform: translateY(-3px); box-shadow: 0 24px 50px -28px rgba(0, 0, 0, 0.35); }
.case img { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; object-position: top; display: block; border-bottom: 1px solid var(--vp-c-divider); }
.case-body { padding: 20px 22px 24px; }
.case h3 { margin: 10px 0 8px; font-size: 22px; }
.case p { margin: 0 0 14px; color: var(--vp-c-text-2); line-height: 1.7; font-size: 15px; }
.tag { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
.tag.web { background: rgba(59, 130, 246, 0.14); color: #3b82f6; }
.tag.desktop { background: rgba(168, 85, 247, 0.14); color: #a855f7; }
.more { font-weight: 600; font-size: 14px; color: var(--vp-c-brand-1); }

.agents { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; align-items: center; padding: 36px; border-radius: 22px; background: var(--vp-c-bg-soft); border: 1px solid var(--vp-c-divider); }
.agents p { color: var(--vp-c-text-2); line-height: 1.7; margin: 0 0 20px; }

@media (max-width: 960px) {
  .hero, .agents { grid-template-columns: 1fr; }
  .pillars { grid-template-columns: 1fr; }
  .grid { grid-template-columns: repeat(2, 1fr); }
  .br { display: none; }
}
@media (max-width: 640px) {
  section { margin-top: 64px; }
  .hero { margin-top: 32px; }
  .case-grid, .grid { grid-template-columns: 1fr; }
  .agents { padding: 24px 20px; }
}
</style>
