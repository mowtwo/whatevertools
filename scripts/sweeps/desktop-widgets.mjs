// 桌面晾衣绳设置页逐页巡检（只有 Electron / uTools 版）
import { tab, byTitle, closeDialog, rendered } from './common.mjs'

const noCrash = rendered
const steps = [
  { name: '晾衣绳页', run: tab('晾衣绳'), expect: noCrash },
  { name: '信号页', run: tab('信号'), expect: noCrash },
  { name: '地毯页', run: tab('地毯'), expect: noCrash },
  { name: '挂件扩展页', run: tab('挂件扩展'), wait: 1500, expect: noCrash },
  { name: '关于弹窗', run: byTitle('关于与版权'), expect: "document.body.innerText.includes('关于桌面晾衣绳')" },
  { name: '关闭关于弹窗', run: closeDialog, wait: 500 },
  { name: '回到晾衣绳页', run: tab('晾衣绳'), expect: noCrash },
]
steps.ready = "document.querySelectorAll('[role=tab]').length >= 4"
export default steps
