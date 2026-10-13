// 巡检步骤共用的小工具（网页版和 Electron 版用同一套步骤）
// Radix 的标签和按钮响应 pointerdown / mousedown，只调 click() 切不过去：模拟完整的一次按下
export const press = (selector) => `{ const el = ${selector}; if (!el) throw new Error('找不到元素'); for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' })) }`
export const tab = (label) => press(`[...document.querySelectorAll('[role=tab]')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})`)
export const byTitle = (title) => press(`document.querySelector('button[title=${JSON.stringify(title)}]')`)
export const closeDialog = "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"
export const rendered = "document.querySelector('#root') && document.querySelector('#root').children.length > 0"
