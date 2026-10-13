// 快拼图网页版逐页巡检：每个标签页、关于 / 快捷键弹窗、AI 编排发一条消息（没有模型时应该给出提示而不是白屏）
import { press, tab, byTitle, closeDialog, rendered } from './common.mjs'

const noCrash = `!document.body.innerText.includes('这个页面出错了') && ${rendered}`

const steps = [
  { name: '拼接页', run: tab('拼接'), expect: `${noCrash} && document.body.innerText.includes('生成拼图')` },
  { name: '编辑页', run: tab('编辑'), expect: noCrash },
  { name: '网格预设页', run: tab('网格预设'), expect: noCrash },
  { name: '工作流页', run: tab('工作流'), expect: noCrash },
  { name: 'AI 编排页', run: tab('AI 编排'), wait: 1800, expect: noCrash },
  {
    name: 'AI 编排：没有模型时发送消息给出提示',
    run: `
      const ta = document.querySelector('textarea')
      if (!ta) throw new Error('找不到输入框')
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      set.call(ta, '把图片横向拼起来'); ta.dispatchEvent(new Event('input', { bubbles: true }))
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`,
    wait: 2000,
    expect: `${noCrash} && /调用大模型失败|没有配置 AI 模型/.test(document.body.innerText)`,
  },
  { name: '快捷键弹窗', run: byTitle('快捷键'), expect: "document.body.innerText.includes('快捷键')" },
  { name: '关闭快捷键弹窗', run: closeDialog, wait: 500 },
  { name: '关于弹窗', run: byTitle('关于与版权'), expect: "document.body.innerText.includes('关于快拼图')" },
  { name: '关闭关于弹窗', run: closeDialog, wait: 500 },
  { name: '回到拼接页', run: tab('拼接'), expect: noCrash },
  {
    name: '功能：导入两张图、拼接（含圆角）、导出',
    run: `
      const mk = (color, w, h) => new Promise((r) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); c.toBlob((b) => b.arrayBuffer().then((a) => r(new Uint8Array(a))), 'image/png') })
      const a = await services.importBytes(await mk('red', 200, 100), 'a')
      const b = await services.importBytes(await mk('blue', 100, 100), 'b')
      const r = await services.stitch({ width: 300, height: 100, background: '#ffffff', name: 'sweep', cells: [
        { image: a.path, left: 0, top: 0, width: 200, height: 100, fit: 'cover' },
        { image: b.path, left: 200, top: 0, width: 100, height: 100, fit: 'cover', radius: 20 },
      ] })
      const dir = utools.getPath('temp')
      window.__sweep = { size: [r.width, r.height], out: await services.exportTo(r.path, services.join(dir, 'sweep.jpg'), 90) }`,
    wait: 1500,
    expect: "JSON.stringify(window.__sweep.size) === '[300,100]' && /sweep/.test(window.__sweep.out)",
  },
]
steps.ready = "document.querySelectorAll('[role=tab]').length >= 5"
export default steps
