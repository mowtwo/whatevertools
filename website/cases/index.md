# 案例

两个真实插件，同一份代码，用 whatevertools 打成各自最合适的形态（它们原本也发布在 uTools 上）。

| 插件 | 形态 | 为什么 |
|---|---|---|
| [快拼图](./quick-union-image) | **网页**（也能出 Electron 应用） | 纯界面 + 图片处理，浏览器里就能完成；Canvas 版 sharp 接上了图片处理 |
| [桌面晾衣绳](./desktop-widgets) | **Electron 独立应用** | 透明置顶悬浮层、鼠标穿透、桌面地毯只有桌面才做得到，插件用 `targets` 声明不出网页版 |

想看更多？把你的插件打包后提 PR 到 [仓库](https://github.com/mowtwo/whatevertools)。
