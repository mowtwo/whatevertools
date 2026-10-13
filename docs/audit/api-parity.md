I've audited every API in the reference against the implementation. Every `window.utools` name in the reference (§21), plus all 10 `db.promises` methods, exists in the compat layer (`packages/compat-utools/src/index.ts:15-147`). The gaps are in behavior, not in names.

`host.ts` was being edited while I read it, so its line numbers may be a few lines off. They match the file as of my last read (673 lines).

## A. Missing

1. **Auto-exit after the main window hides** (§0, default 3 min). There is no idle timer anywhere. A plugin sent to the background, or started for a schedule or MCP call, stays loaded forever. Fix: start a timer in `out(plugin,false)` and in the launcher `hideWindow()`, then call `out(plugin,true)` when it fires.
2. **`onPluginOut(false)` when switching plugins.** `shell.ts:356` (`show`) and `shell.ts:205` (`pick`) call `detachPlugin(active,false,…)` directly, so the plugin being switched away from never receives `pluginOut`. Fix: go through `host.out(active,false)`.
3. **`pluginSetting.single: false`.** It is parsed (`core/src/manifest.ts:168`) but never read. There is only one `mainWc` per plugin (`host.ts` `start`). Fix: allow several instances when `single === false`, or at least warn.
4. **Pinyin / initials search for Chinese commands.** Only the optional `textScorer` hook exists (`compat-utools/src/entries.ts:29`); nothing ships by default. Fix: bundle a pinyin scorer.
5. **`ubrowser.drop`.** It always throws (`services/ubrowser.ts:305-306`). Fix: use CDP `Input.dispatchDragEvent` with files.
6. **MCP `sendProgress` notifications are dropped.** The stream handler is a no-op (`services/mcp.ts:132`), and the server only sends JSON responses, never SSE. Fix: answer `tools/call` as an SSE stream when the progress token is present, and send `notifications/progress`.
7. **Market fallback for `redirect`.** When nothing matches it just returns `false` (`services/data.ts:65`). Acceptable, but the behavior should be documented.
8. **`readCurrentFolderPath` / `readCurrentBrowserUrl` on Windows.** They reject without a provider. Firefox is not supported on macOS either (`services/system.ts:99-104`).
9. **Mouse simulation (`simulateMouse*`).** All four throw EWTUNSUPPORTED (`services/input.ts:83-86`), while `apis.ts:101-104` declares `mock` ("no error, no effect"). Either implement them through a native provider, or make them silent no-ops to match `mock`.
10. **Window `cmds` on Windows/Linux.** The active-window probe exists only for macOS (`shell.ts:14-41`), so `type:"window"` features never match on other platforms.
11. **Sub-input in the detached window.** The detached window has no input bar (`shell.ts:451-480`). `setSubInput` and related calls return `true` but do nothing visible.
12. **Web: `onPluginOut` never fires.** Nothing listens for `pagehide`/`beforeunload` (`web/src/index.ts`).
13. **Web: schedules.** Cron triggers never run, one-shot timers don't survive a reload, and success/failure counts are never updated (`web/src/caps.ts:294-301`).

## B. Wrong behavior

14. **`getCopiedFiles` reports wrong `isFile`/`isDirectory`.** Main returns correct entries, but `preload/caps.ts:227` reduces them to paths. `api/src/index.ts:258` then stats them with `caps.fs?.statSync`, and Electron caps have no `fs`. The result is always `isFile:true, isDirectory:false`, even for folders. Fix: have `readFilesSync` return `FileEntry[]` and pass them through.
15. **`hideMainWindow`, `showMainWindow` and `setExpandHeight` work from a detached window.** The reference says they return `false` unless called from the search-box main window. `core/src/apis.ts:46-48` allows `['main','detach']`, so a detached plugin can hide the launcher or change its height. Fix: `windows: ['main']`.
16. **`outPlugin` from a detached plugin leaves its window open.** `host.out` → `shell.detachPlugin` only removes the view from the launcher window (`shell.ts:375-393`). The detached window stays visible, or empty after a kill. Fix: hide or close `detached.get(id)` there.
17. **`onPluginEnter` can fire before the page has registered its listener.** The bridge runs `start()` on DOMContentLoaded (`preload/index.ts:40-43`), and the host emits `pluginEnter` as soon as the plugin reports ready. Listeners registered by async or lazily loaded chunks miss the first enter. The web build waits for `load`, so the two disagree. Fix: wait for `load`, and/or buffer the last `pluginEnter` until `onPluginEnter` is registered.
18. **Window methods that don't exist on `BrowserWindow`.** `isLoading`, `stop` and `reloadIgnoringCache` are whitelisted in `WINDOW_METHODS` (`apis.ts:239-240`), but on Electron (43.x here) they are `webContents` methods. `callWindow` (`services/windows.ts:84-87`) throws "is not a function". Fix: forward these to `win.webContents`.
19. **`webContents.getPrinters` was removed in modern Electron.** Calling it throws. Fix: map it to `getPrintersAsync` (a sync shim can't work).
20. **`webContents.print(options, callback)` fails.** The function argument goes over `sendSync` and fails structured clone. Fix: drop the callback in the proxy, run `print` asynchronously in main, and invoke the callback locally.
21. **Pasting on macOS hides the whole app.** `services/input.ts:42` calls `app.hide()`, which also hides detached and custom windows, not just the search box. Fix: hide only the launcher window and let focus return.
22. **`showNotification` click can be lost.** The `Notification` object isn't kept alive (`services/system.ts:37-45`), so after garbage collection the click handler never fires. Fix: keep a reference until `click`/`close`.
23. **AI tool handler errors aren't fed back to the model.** `ai.chat` `callTool` (`services/ai.ts:18`) rejects, and nothing turns the rejection into a failed tool-call result. Whether the model sees it depends on the provider. Fix: catch it and return `{error: message}` as the tool result.
24. **`requestSchedule` rejects on bad input.** It throws on a past timestamp or invalid cron (`services/schedule.ts:80-83`). The reference says it resolves when the request flow finishes. The approval prompt is also the generic `schedule` permission and doesn't show the schedule's label. Fix: resolve without creating the task, and show the label in the prompt.
25. **Long `onScheduleTrigger` callbacks are recorded as failures.** There is a hard 10-minute timeout (`schedule.ts:159`). Overlapping cron fires run concurrently, and the per-minute interval can drift.
26. **Errors that should come back as values are thrown when a permission is denied.** `shellOpenPath` rejects instead of resolving an error string, and `db.*` throw EWTPERM instead of returning a `DbResult` (`host.ts:524-526` `dispatch`).
27. **`redirect` to a match command without a payload** enters with `type` = regex/over and `payload` = the label (`data.ts:73-89`). There is no check that the payload satisfies the target's match rule.
28. **Hotkeys on match commands never fire.** Without `autocopy`, `press` requires `type === 'text'` (`compat-utools/src/sources.ts:66`).
29. **`readCurrentFolderPath` returns Finder's front window path even when Finder isn't active,** and returns `''` when there is no window (`system.ts:95-97`).
30. **`getFileIcon('folder')` returns the home-folder icon** (a house on macOS), not a generic folder (`system.ts:20-21`). Fix: use an empty temp directory.
31. **`hideMainWindowTypeString` mishandles emoji/Unicode.** Windows `SendKeys` can't type them, and macOS `keystroke` is unreliable for non-ASCII (`input.ts:33-37`).
32. **`simulateKeyboardTap` mishandles special keys.** On macOS, keys like `f1`–`f12` and `pageup` are typed as literal letters with `keystroke`. On Windows, `command`/`meta` are ignored and F-keys aren't mapped (`input.ts:14-30`).
33. **`getCopiedFiles` on Windows returns only the first file** (reads `FileNameW`, `clipboard.ts:48-51`). Fix: parse `CF_HDROP`.
34. **ubrowser `click`/`dblclick`/`mousedown`/`mouseup` coordinates are page-relative.** Main-frame coordinates are fine, but `screenshot(selector)` uses the element rect without iframe offsets (`ubrowser.ts:370`).
35. **ubrowser `file` ignores XPath and `>>`.** It uses CDP `DOM.querySelector` only (CSS), and doesn't check `fs.read` on the uploaded paths (`ubrowser.ts:290-303`).
36. **ubrowser `setCookies` before `goto` fails without a url.** `url: ck.url ?? wc.getURL()` is `''` (`ubrowser.ts:396`), which contradicts "may precede goto" for details that only have a domain. Fix: build the url from `domain`/`path`.
37. **ubrowser `input` uses `insertText`.** No key events fire, so it isn't "simulated typing" (`ubrowser.ts:271`).
38. **ubrowser `goto` without a timeout and `download` can hang forever** (`ubrowser.ts:222`, `324-331`).
39. **ubrowser output defaults to the OS temp dir.** `screenshot` and `pdf` without a path, and the temp files from `file`, go to the OS temp dir, not the plugin temp dir, and are never cleaned (`ubrowser.ts:173-175`).
40. **Web: `from: 'web'`** is not one of main/panel/hotkey/redirect (`web/src/index.ts:142`).
41. **Web: support table vs. actual behavior.** These are declared mock/partial/emulated in `apis.ts` but have no web capability, so they throw: `showOpenDialog`/`showSaveDialog`, `shellBeep`, `getFileIcon(Async)`, `captureDisplay`, `screenCapture`, `screenColorPick`, `desktopCaptureSources`, `hideMainWindow`/`showMainWindow`, all `setSubInput*`, `redirect`, `redirectHotKeySetting`, `getCmdHotKey`, `openPurchase` without a provider, and sync `db.postAttachment` (declared native). Fix: add stubs or correct the table.

## C. Minor

42. `getAppVersion` returns the mock version (default `0.1.0`), so plugins comparing against uTools versions may branch wrongly.
43. `isPurchasedUser` defaults to `true` (`data.ts:99`). The reference default for a non-purchaser is `false`, so paid features unlock silently.
44. `hideMainWindow(isFocusPrevWindow)` ignores the flag (`shell.ts:371`).
45. `setExpandHeight` returns `true` in standalone mode but does nothing (`shell.ts:395-402`).
46. `setSubInputValue` also fires `onChange` (`windows.ts:117`), which the reference doesn't document.
47. `redirectHotKeySetting` drops `autocopy` (`shell.ts:432`). `getCmdHotKey` returns the Electron accelerator format rather than `"Ctrl+Shift+A"`. Double-tap Ctrl/Alt/Shift can't be registered.
48. `onMainPush` only works when the plugin is already running and ready, with a 300 ms budget and at most 10 items (`shell.ts:145-151`). If `onSelect` isn't registered, the pick is logged and dropped.
49. MCP tool names are prefixed `<pluginId>_<tool>` (`mcp.ts:25`), not the declared names. There is no warning when a declared tool is never registered.
50. `MatchWindow.id` is the pid and `appPath` is `''` (`shell.ts:38`).
51. Feature `icon` (plugin.json or `setFeature`) is never shown; results use the plugin logo (`shell.ts:166`).
52. `setFeature` throws on a code that exists in plugin.json, or on empty `cmds`. The reference is a void upsert.
53. `screenCapture` only covers the display under the cursor, and the main window isn't restored afterwards. `screenColorPick` doesn't hide the panel.
54. FFmpeg: `-hide_banner` is always added, stdin is a pipe (conflicts with `-i -`), there is no progress for audio-only jobs, and there is no install guidance.
55. `onPluginReady` callbacks registered after DOMContentLoaded never run (`api/src/index.ts:371-380`). Custom windows never run them.
56. Temp dir: it's cleaned only when the main webContents is destroyed, with no cleanup on `before-quit` or after a crash. The path `os.tmpdir()/whatevertools/<id>` is shared across hosts (`plugin.ts:50`).
57. Window `on`/`once` throw (`window.ts:22-28`) instead of being absent. Calls on a destroyed window throw "Object has been destroyed", except `isDestroyed`.
58. `apis.ts:100` describes `simulateKeyboardTap` as "only keys inside the plugin window", but the implementation sends system-wide keystrokes.
59. `plugin.listening` is collected but never used. The `emit()` comment ("not sent if the plugin didn't register") is wrong (`host.ts:403`).
60. `EntryRegistry.validate` is never called, so invalid `cmds` are dropped silently.
61. The `windows` restriction is enforced only in Electron `dispatch`, not in the API layer, so web doesn't enforce it.
62. Sharp: there's no guarantee of v0.35.3 or of `toUint8Array`. The renderer loads the host's `sharp`.
63. Web `getAttachment` (sync) returns only cached data, otherwise `null`.

## plugin.json fields and semantics the host doesn't honor

- `pluginSetting.single` (multi-instance is unsupported).
- No check that `preload` is a `.js` file. `logo` must be non-empty, but the file isn't checked to exist.
- The 5-function-commands-per-feature limit, command naming rules (1–80 chars, forbidden characters, emoji-only names) and `label` rules are not enforced.
- Regexes that match anything are skipped when matching, but never reported.
- Feature `icon` is never displayed. Feature `description` is not shown in results.
- `type:"window"` cmds only work on macOS, or with a provider.
- Chinese pinyin search is not built in.
- `tools`: there is no check that each declared tool is registered with `registerTool`. The MCP names are prefixed.
- `mainPush` only works while the plugin is running.
- These are honored: `main` must be .html, paths must stay inside the plugin dir, at least one feature, unique codes, at least one function command, `mainHide` (only from non-`main` entry points), `platform` filtering (`core/src/entries.ts:134`), and `pluginSetting.height` as the initial height.
