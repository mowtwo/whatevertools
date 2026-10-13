I stopped partway through the review, so the coverage below is incomplete. Everything under electron, core, the db/sync/fs packages, web, api, compat-utools, the node and electron shims, cli and launcher was read in full. `packages/bridge/src` was not read, and `bridge-server` is only partly reviewed.

Another session was editing the code while I read it. Most files were copied at 15:06:38 to `/private/tmp/claude-501/-Users-chenwencheng-codebase-ai-app-utools-plugins/7b7c9d61-14e3-4663-8700-4e35e5da78ec/scratchpad/snap`. The cli `index.ts`/`pack.ts` and `bridge-server` were read live after that, and `api/src/index.ts` and `web/src/index.ts` changed again after my read. Line numbers come from what I read and may have moved by a few lines. I did not run anything; every finding comes from reading the code.

## Critical

1. **A plugin can give itself read access to any file through redirect** (`electron/src/main/services/data.ts` ~75-91, `host.ts` `enter()` ~354). `launch.open` takes paths from the plugin (`payload.type === 'files'`), and `enter()` calls `grantPath('fs.read', path)` on each one. The target can be the calling plugin itself. Only the low-risk `redirect` permission is needed. **Fix:** never grant paths from plugin-supplied payloads; only grant paths that came from the user (shell drop/paste, a dialog).

2. **Copying files to the clipboard and reading them back grants read access** (`clipboard.ts` `writeFiles` ~10 and the `readFiles` handler ~66-75). `clipboard.writeFiles` and the legacy `__clipboard writeBuffer` accept any paths. `clipboard.readFiles` then grants `fs.read` on whatever paths are on the clipboard. **Fix:** require `fs.read` for paths written to the clipboard, and don't treat clipboard contents as user intent.

3. **`__win` can load any URL, which gets around the plugin-directory limit** (`services/windows.ts` `callWindow` ~63-81; `core/src/apis.ts` `WINDOW_METHODS` includes `loadURL`). Only `loadFile` is checked. `loadURL('file:///…')` or a remote origin loads under the bridge preload, and then `executeJavaScript`/`capturePage` can read the result. **Fix:** remove `loadURL` from the allowed list, or send it through `pluginUrl()` with the same rules as `createWindow`.

4. **A plugin id of `.` or `..` from the manifest escapes its own folders** (`core/src/manifest.ts` ~158; `plugin.ts` ~48-50). `SAFE_ID` keeps dots, so with `..` the state and data folders become the host data folder itself (which holds `permissions.json` and `mcp-key`), and `fs.plugin` is granted by default. `cleanupTemp()` would also run `rmSync` on `os.tmpdir()`. **Fix:** require ids to match `^[a-z0-9][a-z0-9._-]*$` and reject `.` and `..`.

5. **Every handler name can be called directly over IPC, including inherited object properties** (`host.ts` `dispatch` ~506). The handler is looked up as `this.handlers[method]` on a plain object, so names like `constructor` resolve to inherited functions. Internal `__*` handlers are not in `API_MAP`, so no permission check runs. In particular, `__aiAbort` uses a global map keyed by a stream id the renderer chooses, so one plugin can abort another plugin's AI call. **Fix:** use `Object.hasOwn`, keep an explicit allow-list with the permission each internal handler needs, and key aborts by plugin.

## High

6. **`CH.reply` and `CH.stream` don't check who is sending** (`host.ts` ~575-591). Request ids (`r1, r2…`) and stream ids (`s1…`) count up globally, so any plugin can resolve another plugin's tool call, MCP result or schedule result. **Fix:** remember the target `webContents` id for each pending request and compare it with `e.sender.id`; use random ids.

7. **Scope checks don't normalise paths, and a non-string scope skips the check** (`core/src/permissions.ts` `scopeMatches` ~112-131; `host.ts` `toScope` ~606).
   - A value like `granted/../x` passes a prefix match. In the main process this affects `savePage`, and ubrowser `download`, `screenshot` and `pdf` save paths, which write with full fs access.
   - A non-string scope arg gives `scope === undefined`, which returns "granted" for any scoped grant. A nested array works here, because `String([['x']])` is `'x'`.
   - A scope of `/` normalises to `''` and never matches.
   - An empty-host scope (saved after allowing a `mailto:` link) matches every `file:` URL.

   **Fix:** run `path.resolve` (and preferably `realpath`) before matching; reject scope args that aren't strings; treat a missing scope on a scoped grant as "ask".

8. **`shell.openExternal` accepts any URL scheme** (`services/system.ts` ~69). `file:`, `smb:` and custom protocol handlers all go through. **Fix:** allow only http, https and mailto, as `openExternalChecked` already does.

9. **ubrowser can read local files with only the `browser` permission.**
   - `goto` accepts `file:` URLs.
   - The `file` op passes any local paths to `DOM.setFileInputFiles`, so local files can be uploaded to a web page without `fs.read`.
   - `__ubrowserRun` checks `browser` with no scope first, so answering "always" there grants every URL.

   **Fix:** allow only http(s) in `goto`, require `fs.read` for each path in `file`, and prompt with the URL.

10. **Remote pages in custom windows get the full plugin API** (`windows.ts` ~43). `createBrowserWindow('http://…')` loads under the bridge preload with `contextIsolation: false`. Plain http also lets a man-in-the-middle inject script that runs with the plugin's permissions. Separately, the navigation guard then blocks same-origin navigation inside these windows, which is a functional bug. **Fix:** give remote URLs no preload (or https only with an opt-in), and allow that origin in `guardNavigation`.

11. **Pasting or putting files on the clipboard doesn't check fs access** (`input.ts` `pasteFiles`, `clipboard.writeFiles`). A plugin can paste arbitrary local files into the foreground app. **Fix:** require `fs.read` for each path.

12. **Unpushed sync changes can be lost for good** (`core/src/db.ts` `changesSince` ~282; `core/src/sync.ts` `push` ~74). `changeLog` lives only in memory. After a restart, `seq > pushedSeq` but the log is empty, so `changesSince` returns `[]`. `push` then records `pushedSeq = upTo` without sending anything. This happens if the app quits within `pushDelay` (1 s) or while offline. **Fix:** do a full scan when the log doesn't cover `since`, or save the log to disk.

13. **The renderer fs guard can be bypassed** (`preload/guard.ts`). The file header says this guard is not a security boundary, but these are real bypasses:
    - `toPath` returns `null` ("allow") for a `Uint8Array` that isn't a `Buffer` and for URL-like objects; Node's fs accepts both.
    - Constructors whose names start with a capital (`fs.ReadStream`, `fs.WriteStream`) are skipped.
    - `inside()` doesn't follow symlinks, so a symlink inside the plugin package reads outside it.
    - If the plugin directory path contains a symlink (for example `/tmp` → `/private/tmp`), `fromPlugin()` compares a realpath `module.filename` with a non-real `dir`, and the guard turns off completely.
    - `require.cache` and `module.constructor._load` reach the unguarded `require`.
    - URL paths are decoded with `decodeURIComponent(pathname)`, which is wrong on Windows; use `fileURLToPath`.
    - Wrapped functions lose `realpath.native` and the `util.promisify.custom` symbol.

14. **ffmpeg is effectively unrestricted file access** (`preload/caps.ts` ~344). The low-risk `media.ffmpeg` permission is checked only in the renderer, and ffmpeg can read and write any file. Document this, or check the input and output paths.

15. **The renderer can hang on a synchronous call** (`host.ts` `CH.sync` ~540). If the returned value can't be structured-cloned (for example the inherited-handler call in #5, or an error whose `data` isn't cloneable), assigning `e.returnValue` throws inside `.then`. `returnValue` is never set, the renderer stays blocked in `sendSync`, and the main process gets an unhandled rejection. **Fix:** wrap the assignment in try/catch and fall back to a plain error.

16. **Web target: page scripts start too late** (`cli/src/pack.ts` ~281-310; `web/src/index.ts` `start`). Page scripts are deferred until after `boot()`, but `boot()` already emits `pluginEnter` and runs `onReady` before they load. Plugins that register `onPluginEnter` in page scripts miss it. `DOMContentLoaded` and `load` listeners in page code never fire. **Fix:** emit enter and ready after the deferred chain finishes, and dispatch a synthetic `DOMContentLoaded`.

17. **`pack` leaves out `node_modules` and dotfiles** (`cli/src/report.ts` `walk` ~16-24, used by `copyDir`). The utools and electron outputs lose preload dependencies.

## Medium

- **Permission prompts:**
  - Prompts are de-duplicated per plugin and permission, not per scope, so a second concurrent request for a different path is silently denied (`host.ts` `ask`).
  - "Always" grants `dirname(file)`, so allowing a file in `~` grants the whole home folder. Even "once" grants the folder for the session.
  - A new scoped "always" replaces earlier scopes instead of adding to them (`permissions.ts` `answer`).
- **Unbounded waits and leaks:** `host.request` has no timeout or cleanup when the `webContents` is destroyed. This hangs `ai.chat` tool calls and leaks the 300 ms `mainPush` races in `shell.ts` `query`.
- **Search results can mismatch the list on screen** (`shell.ts` `query`). Overlapping queries finish out of order and overwrite `this.results`/`pushed`, so `choose(i)` can open the wrong feature. The renderer ignores stale results, but the main process doesn't.
- **First `onPluginEnter` can be lost.** `emit()` drops the event if the listener registers after ready, and `plugin.listening` is never used.
- **Main-process stalls and crashes from plugin input or the network:**
  - Plugin regexes in feature cmds run on every keystroke in the main process (`compat-utools/src/entries.ts`); a catastrophic regex freezes the app.
  - MCP: `new URL(req.url)` and body-read errors happen inside `void this.handle()` before any try, causing unhandled rejections and requests that never get a response.
  - `FolderSync.watch` has no `'error'` listener on the FSWatcher; an unmounted folder can crash the main process.
  - The sync-http reference server crashes on a malformed `%` in the URL (`decodeURIComponent` throws).
  - `shell.ts` `choose`: the `enter()` rejection inside the `.then` success callback isn't handled.
- **DocDb flush can drop a batch** (`DocDb.flush`). If `backend.write` rejects, that batch is gone (`pending` was already swapped out), and the timer's `void` turns it into an unhandled rejection. `postAttachment` checks an id and then awaits before reserving it, so two calls with the same id both succeed.
- **FileBackend writes without fsync.** After a power loss, `db.json` can be empty or corrupt; it is set aside, and the next write replaces it with an empty database.
- **ubrowser `download`:** if the URL doesn't start a download, it waits forever, and the session's `will-download` listener is shared across concurrent runs.
- **Scheduler misses minutes:** `setInterval` drift and sleep can skip cron minutes. One-shot task failures aren't retried.
- **Tray can disappear:** the `Tray` is only held in a local variable in `app.ts`, so it can be garbage-collected.
- **Custom-window overlay check can be bypassed** (`windows.ts` `isOverlay`). It misses `opacity: ~0` + `fullscreen`, opaque frameless fullscreen, and `type`.
- **Clipboard loss:** `readSelection` restores only text or an image, so files, HTML and RTF on the user's clipboard are lost.

## Low

- `ipcMain.handle` is registered in constructors, so creating `WhateverToolsHost` or `WindowShell` twice throws.
- `whenTool` doesn't remove its waiter after a timeout.
- ubrowser adds a new `once('closed')` listener every time a window is reused.
- MCP tool names that collide after sanitising silently overwrite each other.
- `VirtualFs`:
  - Renaming a directory into itself, or onto an existing directory, leaves orphaned nodes.
  - A failed lazy load is an unhandled rejection, and the node stays in EAGAIN forever.
  - `statSync` reports size 0 for lazy files.
- Shims:
  - `dirname('/')` returns `'.'`.
  - `pathToFileURL` doesn't encode `#`/`?`.
  - `promisify(fs.exists)` rejects.
- Web runtime:
  - Pending DocDb writes aren't flushed on `pagehide`.
  - Same-origin plugins share `localStorage` permissions.
  - The `postMessage` handler doesn't check `e.source`.
- Settings page: policy-locked permissions look editable, because `locked` is never sent.
- `cli` parse: `--dev ./plugin` uses the path as the flag's value.
- The launcher crashes with an error dialog on a malformed config file.

## Bridge-server (partial)

- Its `permissions.answer` endpoint lets the browser page give itself any grant. Anyone holding the token, plus an allowed origin, can self-authorise.
- `/v1/spawn` checks `process.spawn` against the command string only.
- `system.env` returns the whole environment.
- The token is also accepted in the query string, where it can leak into logs.
- With origin `'*'`, it allows requests that send no `Origin` header at all.
