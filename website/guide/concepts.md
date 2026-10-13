# 核心概念

## 分层

```
插件代码 ──► 兼容层（@whatevertools/compat-utools：window.utools、plugin.json、入口类型、唤起来源）
             │
             ▼
         原生 API（@whatevertools/api：window.whatevertools，按命名空间组织）
             │  只依赖能力接口
             ▼
         能力接口（core）◄── Node / Electron 模块垫片（shim-node、shim-electron）
             │
   ┌─────────┴──────────┐
 Electron 平台          网页平台               （Tauri：规划中）
   │ main 进程宿主        │ 浏览器运行时 + 适配器包
   ▼                     ▼
 宿主核心引擎（core）：插件表、生命周期、权限、入口与来源、定时任务、动态功能、快捷键、提供者、身份、同步
```

- **平台无关的核心**：生命周期、权限、入口、调度、存储、同步都在 `@whatevertools/core`，平台只实现适配器接口。
- **兼容层**：uTools 特有的名字只出现在 `compat-utools`。宿主可以改注入名（`window.myhost`）或者不加载兼容层。
- **适配器包**：给某个平台补能力的实现（网页上的 sharp、文件对话框、虚拟文件系统……）都是独立的包，宿主可以替换。

## 插件描述

| 文件 | 谁读 | 作用 |
|---|---|---|
| `plugin.json` | uTools、兼容层 | uTools 插件描述 |
| `whatevertools.json` | 兼容层 | 补充身份、权限用途说明、`targets`、独立应用配置；带 `main` 字段时就是原生格式的插件描述。uTools 不读它 |

```json
{
  "id": "quick-union-image",
  "name": "快拼图",
  "version": "1.2.0",
  "targets": ["utools", "electron", "web"],
  "permissions": { "fs.read": { "reason": "读取你选择、拖入或粘贴的图片" } },
  "standalone": { "productName": "快拼图", "startFeature": "stitch" }
}
```

## targets

插件声明自己能在哪些目标上运行。只在桌面上成立的插件（透明置顶悬浮层、桌面挂件）写 `["utools", "electron"]`，打包到网页会直接报错，网页宿主也会拒绝安装。

## 身份与版本

插件能拿到底座（运行时）版本、宿主名字和版本（任意字符串，插件自行解析）、伪装平台名和版本（旧插件 `getAppName` / `getAppVersion` 看到的值）、插件自己的名字和版本：

```ts
whatevertools.identity
// { runtime: { name, version }, host: { name, version }, mock: { platform, runtime }, plugin: { id, name, version }, env }
```

## 支持程度

每个 API 在每个平台上标为：**原生**（行为一致）、**模拟**（换了实现、语义一致）、**部分**、**占位**（不报错但没效果）、**不支持**（抛 `EWTUNSUPPORTED`，宿主可配成警告）。完整表见 [API 支持程度](./api-support)，运行时用 `supports(name)` 查询。
