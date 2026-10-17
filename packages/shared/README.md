# @whatevertools/shared

通用能力探测：一个能力 = 按顺序排列的几种实现，调用时用第一个可用的；都不可用时抛统一的 `UnsupportedError`（可带升级提示），而不是 `xxx is not a function`。

零依赖、不碰 Node 和 DOM：preload 和 renderer 都能用，uTools 本体、Electron 独立应用、网页版也都一样。CommonJS 产物是单个文件、没有 `require`，可以直接拷进 uTools 插件给 preload 用。

```js
const { capability, method, onUnsupported, report, UnsupportedError } = require('@whatevertools/shared')

// 新版宿主才有的 API：旧版上退回替代实现
const dataDir = capability('paths.data', [
  method(() => utools, 'getPluginLocalDataPath'),
  { id: 'userData', available: () => typeof utools.getPath === 'function', run: () => utools.getPath('userData') + '/my-plugin' },
], { hint: '请升级 uTools 到 8.0 以上' })

dataDir()          // 用第一个可用的实现
dataDir.support()  // 'getPluginLocalDataPath' | 'userData' | false
dataDir.try()      // 没有可用实现时返回 undefined，不抛错

// 注册事件这类「没有就算了」的能力
const onTrigger = capability('schedule.onTrigger', [method(() => utools, 'onScheduleTrigger')], { missing: 'noop' })

onUnsupported(({ name, hint }) => console.warn(name, hint)) // 每个能力只通知一次
report()                                                     // 每个能力实际用了哪种实现，适合写日志
```

- `fallbackOnError: true`：选中的实现抛错（或 Promise 失败）时换下一种重试；默认关闭，避免有副作用的调用做两遍。
- `UnsupportedError.is(e)`：跨副本判断（preload 和页面各带一份时 `instanceof` 不可靠）。
- `cap.reset()`：清掉探测缓存。

这是 [whatevertools](https://github.com/mowtwo/whatevertools) 的一部分。

MIT
