---
title: 桌面晾衣绳 · Electron 案例
---

# 桌面晾衣绳 · Electron

在桌面顶部拉一根晾衣绳：挂便签、待办、时钟、计时器、文件夹和截图，还有桌面地毯和信号轮盘。原本是 uTools 插件，用 whatevertools 打包成**不依赖 uTools 的 Electron 独立应用**。

[插件源码](https://github.com/mowtwo/utools-desktop-widgets){target="_blank"}

<Shots base="/cases/desktop-widgets" :items="[
  { file: '01.jpg', caption: '晾衣绳' },
  { file: '02.jpg', caption: '文件夹衣架' },
  { file: '03.jpg', caption: '待办卡片' },
  { file: '04.jpg', caption: '信号轮盘' },
  { file: '05.jpg', caption: '信号截图' },
  { file: '06.jpg', caption: '桌面地毯' },
  { file: '07.jpg', caption: '挂件扩展' },
  { file: '08.jpg', caption: '信号设置' },
]" />

## 为什么只出桌面版

这个插件的核心是**透明、置顶、鼠标穿透的全屏悬浮层**：绳子和挂件浮在所有窗口上面，只有挂件本身能点，其他地方点下去落到桌面。再加上桌面地毯、按显示器摆放、鼠标顶到屏幕边缘的检测、截图挂到绳上——这些浏览器都做不到。

所以插件在 `whatevertools.json` 里声明：

```json
{ "targets": ["utools", "electron"] }
```

`wt pack --target web` 会直接拒绝，网页宿主也不会安装它。

## 打包

```bash
npx whatevertools pack ./dist --target electron --product 桌面晾衣绳
# 或者用配置文件出签名安装包
npx whatevertools build --target electron --binary
```

在 Electron 宿主里，悬浮层窗口、权限询问（覆盖层、截屏、剪贴板……按插件单独授权）、定时任务、MCP 工具（让 AI Agent 挂便签、加待办、发信号）都能工作。

## 致谢

晾衣绳造型参考 [Tendedero](https://github.com/alejandrobujan/tendedero)（MIT）；桌面地毯移植自 [desktop-rug](https://github.com/josssphzhou/desktop-rug)（MIT，创意与视觉设计来自 Terkel）；信号轮盘与特效移植自 [lolPing](https://github.com/darrenprx/lolPing)（MIT）；信号图标来自 [game-icons.net](https://game-icons.net)（CC BY 3.0），音效来自 [Kenney](https://kenney.nl)（CC0）。
