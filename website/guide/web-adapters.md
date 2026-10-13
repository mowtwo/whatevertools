# 网页适配器

网页平台没有 Node 和 Electron。缺的能力由一组**可替换的适配器包**补上：运行时默认接入，宿主可以换成自己的实现，也可以关掉。

| 包 | 补的能力 | 默认 |
|---|---|---|
| `@whatevertools/fs-virtual` | `fs` / `fs/promises`：内存常驻、IndexedDB 持久化的 POSIX 文件系统；`/drop` `/picked` `/downloads` `/tmp` 不落盘 | 是 |
| `@whatevertools/db-indexeddb` | 插件数据库 `utools.db` / `dbStorage` | 是 |
| `@whatevertools/sharp-canvas` | `utools.sharp`：Canvas 实现的常用子集 | full 入口默认 |
| `@whatevertools/web-files` | `showOpenDialog` / `showSaveDialog` / `dialog.openAsync` / `shell.openPath`：浏览器文件选择器和下载 | 是（`fileDialogs: false` 关闭） |
| `@whatevertools/shim-node` / `shim-electron` | `path` `os` `events` `util` `crypto` `buffer`……以及 `ipcRenderer` `clipboard` `nativeImage` | 是 |
| `@whatevertools/bridge` + `bridge-server` | 真实文件系统、子进程、系统剪贴板、shell：通过本地守护进程，守护进程用系统对话框问权限 | 否（配置 `bridge`） |
| `@whatevertools/sync-http` / `sync-folder` | 数据同步 | 否（配置 `sync`） |

## sharp-canvas

<!--@include: ../../packages/sharp-canvas/README.md{2,}-->
