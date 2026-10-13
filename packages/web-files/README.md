# @whatevertools/web-files

[whatevertools](https://github.com/mowtwo/whatevertools) 的网页适配器：在虚拟文件系统上实现文件对话框和下载。

- `showSaveDialog` / `dialog.saveAsync`：返回 `/downloads/<文件名>`，插件写完文件后由浏览器下载；
- 选目录且带 `createDirectory`：返回 `/downloads`，写进去的每个文件都会下载；
- `dialog.openAsync`：浏览器文件选择器，选中的文件放在 `/picked` 下；同步的 `showOpenDialog` 返回 `undefined`，选择结果交给 `onDeferredPick`；
- `shell.openPath`：对下载目录里的文件重新下载一次。

web 运行时默认接入，`boot({ fileDialogs: false })` 关闭。

MIT
