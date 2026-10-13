import { defineConfig } from 'vitepress'

const repo = 'https://github.com/mowtwo/whatevertools'

export default defineConfig({
  lang: 'zh-CN',
  title: 'whatevertools',
  description: '启动器插件的通用运行时：一套插件跑在 uTools、Electron 和网页上，几行代码给你的应用和网站加上插件生态。',
  cleanUrls: true,
  lastUpdated: true,
  // 在线演示是打包好的静态站点，不经过 VitePress
  srcExclude: ['public/**'],
  ignoreDeadLinks: [/^\/demo\//, /^\/llms/, /^\/skills\//],
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#ff5a1f' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'whatevertools · 插件，随便跑在哪' }],
    ['meta', { property: 'og:description', content: '一套插件跑在 uTools、Electron 和网页上；几行代码给你的 Electron 应用和网站加上插件生态。' }],
    ['link', { rel: 'alternate', type: 'text/plain', href: '/llms.txt', title: 'llms.txt' }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: '指南', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: '案例', link: '/cases/', activeMatch: '/cases/' },
      { text: 'API 支持', link: '/guide/api-support' },
      { text: '给 AI Agent', link: '/guide/agents' },
      { text: '在线试用', link: '/demo/quick-union-image/index.html', target: '_blank' },
    ],
    sidebar: {
      '/guide/': [
        { text: '开始', items: [
          { text: '快速开始', link: '/guide/getting-started' },
          { text: '核心概念', link: '/guide/concepts' },
        ] },
        { text: '插件作者', items: [
          { text: '移植 uTools 插件', link: '/guide/porting' },
          { text: 'Vite 项目', link: '/guide/vite' },
          { text: '打包与签名', link: '/guide/packaging' },
        ] },
        { text: '平台与宿主', items: [
          { text: '给 Electron 应用加插件', link: '/guide/electron-host' },
          { text: '给网站加插件', link: '/guide/web-host' },
          { text: '插件包（upx）', link: '/guide/packages' },
          { text: 'hook 与权限', link: '/guide/hooks' },
          { text: '网页适配器', link: '/guide/web-adapters' },
        ] },
        { text: '参考', items: [
          { text: 'API 支持程度', link: '/guide/api-support' },
          { text: '给 AI Agent', link: '/guide/agents' },
        ] },
      ],
      '/cases/': [
        { text: '案例', items: [
          { text: '总览', link: '/cases/' },
          { text: '快拼图 · 网页', link: '/cases/quick-union-image' },
          { text: '桌面晾衣绳 · Electron', link: '/cases/desktop-widgets' },
        ] },
      ],
    },
    socialLinks: [{ icon: 'github', link: repo }],
    search: { provider: 'local', options: { translations: { button: { buttonText: '搜索文档' }, modal: { noResultsText: '没有找到', footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' } } } } },
    editLink: { pattern: `${repo}/edit/main/website/:path`, text: '在 GitHub 上编辑此页' },
    outline: { label: '本页目录', level: [2, 3] },
    docFooter: { prev: '上一页', next: '下一页' },
    lastUpdated: { text: '最后更新' },
    darkModeSwitchLabel: '外观',
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    footer: { message: 'MIT License', copyright: '© 2026 mowtwo · 与 uTools 官方无关' },
  },
})
