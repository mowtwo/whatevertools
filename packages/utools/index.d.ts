// window.utools 的类型（与 uTools 官方开发文档一致）。只有类型，不产生任何运行时代码。
// 用法：在 tsconfig 的 types 里加 "@whatevertools/utools"，或在任意 .d.ts 里 /// <reference types="@whatevertools/utools" />
// 想把 window.utools 声明成可选（比如浏览器里调试界面）时，改为引用 "@whatevertools/utools/namespace"，自己声明 Window.utools

/// <reference path="./namespace.d.ts" />

export {}

declare global {
  interface Window {
    utools: UTools.Api
  }
  const utools: UTools.Api
}
