var __dirname = "/plugin", __filename = "/plugin/preload.js";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // whatevertools-shim:node:fs
  var require_node_fs = __commonJS({
    "whatevertools-shim:node:fs"(exports, module) {
      module.exports = globalThis.__whatevertoolsRequire("node:fs");
    }
  });

  // whatevertools-shim:node:fs/promises
  var require_promises = __commonJS({
    "whatevertools-shim:node:fs/promises"(exports, module) {
      module.exports = globalThis.__whatevertoolsRequire("node:fs/promises");
    }
  });

  // whatevertools-shim:node:path
  var require_node_path = __commonJS({
    "whatevertools-shim:node:path"(exports, module) {
      module.exports = globalThis.__whatevertoolsRequire("node:path");
    }
  });

  // whatevertools-shim:electron
  var require_electron = __commonJS({
    "whatevertools-shim:electron"(exports, module) {
      module.exports = globalThis.__whatevertoolsRequire("electron");
    }
  });

  // ../../utools-quick-union-image/dist/mcp-tools.js
  var require_mcp_tools = __commonJS({
    "../../utools-quick-union-image/dist/mcp-tools.js"(exports) {
      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
      var uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      var BASE = {
        padding: 0,
        gap: 8,
        radius: 0,
        background: "#ffffff",
        defaultFit: "cover",
        defaultPosition: "center"
      };
      function gridCells(rows, cols) {
        const cells = [];
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({
          id: uid(),
          x: c / cols,
          y: r / rows,
          w: 1 / cols,
          h: 1 / rows
        });
        return cells;
      }
      function makeGrid(name, rows, cols, extra) {
        return {
          ...BASE,
          id: uid(),
          kind: "grid",
          name,
          rows,
          cols,
          cells: gridCells(rows, cols),
          sizeMode: "auto",
          width: 2048,
          height: 2048,
          ...extra
        };
      }
      function freeGrid(id, name, rects) {
        return {
          ...BASE,
          id,
          kind: "grid",
          name,
          builtin: true,
          rows: 0,
          cols: 0,
          cells: rects.map(([x, y, w, h], i) => ({
            id: `${id}-${i}`,
            x,
            y,
            w,
            h
          })),
          sizeMode: "fixed",
          width: 2048,
          height: 2048
        };
      }
      function builtinGrid(rows, cols) {
        const id = `builtin-grid-${rows}x${cols}`;
        const g = makeGrid(`${rows} \u884C \xD7 ${cols} \u5217`, rows, cols, {
          id,
          builtin: true
        });
        g.cells = g.cells.map((c, i) => ({
          ...c,
          id: `${id}-${i}`
        }));
        return g;
      }
      function builtinStrip(id, name, direction, lanes) {
        return {
          ...BASE,
          gap: 0,
          id,
          kind: "strip",
          name,
          builtin: true,
          direction,
          size: 0,
          lanes,
          count: 0
        };
      }
      function builtinJustify(id, name, direction, lines, count = 0) {
        return {
          ...BASE,
          gap: 0,
          id,
          kind: "justify",
          name,
          builtin: true,
          direction,
          lines,
          width: 0,
          height: 0,
          autoBase: "min",
          count
        };
      }
      var T = 1 / 3;
      var BUILTIN_LAYOUTS = [
        builtinJustify("builtin-justify-h", "\u7B49\u9AD8\u6A2A\u62FC", "horizontal", 1),
        builtinJustify("builtin-justify-v", "\u7B49\u5BBD\u7AD6\u62FC", "vertical", 1),
        builtinJustify("builtin-justify-h2", "\u7B49\u9AD8\u4E24\u884C", "horizontal", 2),
        builtinJustify("builtin-justify-pair", "\u6BCF\u4E24\u5F20\u7B49\u9AD8\u6A2A\u62FC", "horizontal", 1, 2),
        builtinStrip("builtin-strip-v", "\u7AD6\u5411\u957F\u56FE", "vertical", 1),
        builtinStrip("builtin-strip-h", "\u6A2A\u5411\u957F\u56FE", "horizontal", 1),
        builtinStrip("builtin-strip-v2", "\u53CC\u5217\u7011\u5E03", "vertical", 2),
        builtinGrid(1, 2),
        builtinGrid(2, 1),
        builtinGrid(1, 3),
        builtinGrid(3, 1),
        builtinGrid(2, 2),
        builtinGrid(2, 3),
        builtinGrid(3, 2),
        builtinGrid(3, 3),
        builtinGrid(4, 4),
        freeGrid("builtin-free-l1r2", "\u5DE6\u4E00\u53F3\u4E8C", [
          [
            0,
            0,
            0.5,
            1
          ],
          [
            0.5,
            0,
            0.5,
            0.5
          ],
          [
            0.5,
            0.5,
            0.5,
            0.5
          ]
        ]),
        freeGrid("builtin-free-l2r1", "\u5DE6\u4E8C\u53F3\u4E00", [
          [
            0,
            0,
            0.5,
            0.5
          ],
          [
            0,
            0.5,
            0.5,
            0.5
          ],
          [
            0.5,
            0,
            0.5,
            1
          ]
        ]),
        freeGrid("builtin-free-t1b2", "\u4E0A\u4E00\u4E0B\u4E8C", [
          [
            0,
            0,
            1,
            0.5
          ],
          [
            0,
            0.5,
            0.5,
            0.5
          ],
          [
            0.5,
            0.5,
            0.5,
            0.5
          ]
        ]),
        freeGrid("builtin-free-t1b3", "\u4E0A\u4E00\u4E0B\u4E09", [
          [
            0,
            0,
            1,
            2 * T
          ],
          [
            0,
            2 * T,
            T,
            T
          ],
          [
            T,
            2 * T,
            T,
            T
          ],
          [
            2 * T,
            2 * T,
            T,
            T
          ]
        ]),
        freeGrid("builtin-free-big5", "\u4E00\u5927\u4E94\u5C0F", [
          [
            0,
            0,
            2 * T,
            2 * T
          ],
          [
            2 * T,
            0,
            T,
            T
          ],
          [
            2 * T,
            T,
            T,
            T
          ],
          [
            0,
            2 * T,
            T,
            T
          ],
          [
            T,
            2 * T,
            T,
            T
          ],
          [
            2 * T,
            2 * T,
            T,
            T
          ]
        ]),
        freeGrid("builtin-free-center", "\u4E2D\u5FC3\u4E5D\u5BAB", [
          [
            T,
            T,
            T,
            T
          ],
          [
            0,
            0,
            T,
            T
          ],
          [
            T,
            0,
            T,
            T
          ],
          [
            2 * T,
            0,
            T,
            T
          ],
          [
            0,
            T,
            T,
            T
          ],
          [
            2 * T,
            T,
            T,
            T
          ],
          [
            0,
            2 * T,
            T,
            T
          ],
          [
            T,
            2 * T,
            T,
            T
          ],
          [
            2 * T,
            2 * T,
            T,
            T
          ]
        ])
      ];
      function cellIndex(cell, order) {
        return cell.index ?? order;
      }
      function slotCount(layout) {
        if (layout.kind !== "grid") return Math.max(0, Math.round(layout.count || 0));
        return layout.cells.reduce((m, c, i) => Math.max(m, cellIndex(c, i) + 1), 0);
      }
      var MAX_SIDE = 3e4;
      var EPS = 1e-6;
      function median(values) {
        const s = [...values].sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)];
      }
      function resolveLayout(layout, images) {
        if (layout.kind === "strip") return resolveStrip(layout, images);
        if (layout.kind === "justify") return resolveJustify(layout, images);
        return resolveGrid(layout, images);
      }
      function resolveGrid(layout, images) {
        const pad2 = Math.max(0, layout.padding);
        const gap = Math.max(0, layout.gap);
        const W = Math.max(16, Math.round(layout.width));
        const innerW = Math.max(1, W - pad2 * 2);
        let H;
        if (layout.sizeMode === "fixed") H = Math.max(16, Math.round(layout.height));
        else {
          const candidates = [];
          layout.cells.forEach((cell, i) => {
            const img = images[cellIndex(cell, i)];
            if (img && img.width > 0 && cell.h > 0) candidates.push(cell.w * innerW * img.height / (cell.h * img.width));
          });
          const innerH2 = candidates.length ? median(candidates) : layout.rows && layout.cols ? innerW * layout.rows / layout.cols : innerW;
          H = Math.round(Math.min(MAX_SIDE, innerH2 + pad2 * 2));
        }
        const innerH = Math.max(1, H - pad2 * 2);
        const cells = layout.cells.map((cell, i) => {
          const x0 = pad2 + cell.x * innerW + (cell.x > EPS ? gap / 2 : 0);
          const x1 = pad2 + (cell.x + cell.w) * innerW - (cell.x + cell.w < 0.999999 ? gap / 2 : 0);
          const y0 = pad2 + cell.y * innerH + (cell.y > EPS ? gap / 2 : 0);
          const y1 = pad2 + (cell.y + cell.h) * innerH - (cell.y + cell.h < 0.999999 ? gap / 2 : 0);
          return {
            key: cell.id,
            order: i,
            slot: cellIndex(cell, i),
            left: Math.round(x0),
            top: Math.round(y0),
            width: Math.max(1, Math.round(x1) - Math.round(x0)),
            height: Math.max(1, Math.round(y1) - Math.round(y0)),
            fit: cell.fit ?? layout.defaultFit,
            position: cell.position ?? layout.defaultPosition,
            background: cell.background
          };
        });
        return {
          width: W,
          height: H,
          cells
        };
      }
      function resolveStrip(layout, images) {
        const pad2 = Math.max(0, layout.padding);
        const gap = Math.max(0, layout.gap);
        const lanes = Math.max(1, Math.round(layout.lanes));
        const vertical = layout.direction === "vertical";
        const first = images.find((x) => !!x && x.width > 0);
        const laneSize = Math.max(16, Math.round(layout.size || (first ? vertical ? first.width : first.height : 1024)));
        const laneOffsets = new Array(lanes).fill(0);
        const cells = [];
        images.forEach((img, i) => {
          if (!img || img.width <= 0 || img.height <= 0) return;
          const lane = laneOffsets.indexOf(Math.min(...laneOffsets));
          const along = Math.max(1, Math.round(vertical ? laneSize * img.height / img.width : laneSize * img.width / img.height));
          const cross = pad2 + lane * (laneSize + gap);
          const pos = pad2 + laneOffsets[lane];
          cells.push({
            key: `strip-${i}`,
            order: i,
            slot: i,
            left: vertical ? cross : pos,
            top: vertical ? pos : cross,
            width: vertical ? laneSize : along,
            height: vertical ? along : laneSize,
            fit: "fill",
            position: "center"
          });
          laneOffsets[lane] += along + gap;
        });
        const crossTotal = pad2 * 2 + lanes * laneSize + (lanes - 1) * gap;
        const alongTotal = Math.max(1, Math.max(...laneOffsets) - (cells.length ? gap : 0)) + pad2 * 2;
        return {
          width: Math.min(MAX_SIDE, vertical ? crossTotal : alongTotal),
          height: Math.min(MAX_SIDE, vertical ? alongTotal : crossTotal),
          cells
        };
      }
      function partition(aspects, lines) {
        const n = Math.min(Math.max(1, lines), aspects.length);
        const rows = [];
        let start = 0;
        let remaining = aspects.reduce((a, b) => a + b, 0);
        for (let r = 0; r < n; r++) {
          const left = n - r;
          if (left === 1) {
            rows.push(aspects.map((_, i) => i).slice(start));
            break;
          }
          const target = remaining / left;
          const row = [];
          let sum = 0;
          while (start < aspects.length - (left - 1)) {
            const a = aspects[start];
            if (row.length && Math.abs(sum + a - target) > Math.abs(sum - target)) break;
            row.push(start);
            sum += a;
            start++;
          }
          remaining -= sum;
          rows.push(row);
        }
        return rows;
      }
      function resolveJustify(layout, images) {
        const horizontal = layout.direction === "horizontal";
        const pad2 = Math.max(0, layout.padding);
        const gap = Math.max(0, layout.gap);
        const items = images.map((img, i) => ({
          img,
          i
        })).filter((x) => !!x.img && x.img.width > 0 && x.img.height > 0).map(({ img, i }) => ({
          slot: i,
          w: horizontal ? img.width : img.height,
          h: horizontal ? img.height : img.width
        }));
        const fixedMain = Math.max(0, Math.round(horizontal ? layout.width : layout.height));
        const fixedCross = Math.max(0, Math.round(horizontal ? layout.height : layout.width));
        if (!items.length) {
          const w = fixedMain || 1024;
          const h = fixedCross || 1024;
          return {
            width: horizontal ? w : h,
            height: horizontal ? h : w,
            cells: []
          };
        }
        const aspects = items.map((x) => x.w / x.h);
        const rows = partition(aspects, layout.lines);
        const rowAspect = rows.map((r) => r.reduce((s, i) => s + aspects[i], 0));
        const rowGaps = rows.map((r) => (r.length - 1) * gap);
        const crossGaps = (rows.length - 1) * gap;
        let innerMain;
        let rowHeights;
        if (fixedMain) {
          innerMain = Math.max(1, fixedMain - pad2 * 2);
          rowHeights = rows.map((_, r) => Math.max(1, (innerMain - rowGaps[r]) / rowAspect[r]));
          if (fixedCross) {
            const k = Math.max(rows.length, fixedCross - pad2 * 2 - crossGaps) / rowHeights.reduce((a, b) => a + b, 0);
            rowHeights = rowHeights.map((h) => h * k);
          }
        } else {
          let lineH;
          if (fixedCross) lineH = Math.max(1, (fixedCross - pad2 * 2 - crossGaps) / rows.length);
          else {
            const hs = items.map((x) => x.h);
            lineH = layout.autoBase === "max" ? Math.max(...hs) : layout.autoBase === "median" ? median(hs) : Math.min(...hs);
          }
          rowHeights = rows.map(() => lineH);
          innerMain = Math.max(...rows.map((_, r) => lineH * rowAspect[r] + rowGaps[r]));
        }
        const cells = [];
        let crossPos = pad2;
        rows.forEach((row, r) => {
          const rh = Math.round(rowHeights[r]);
          const avail = innerMain - rowGaps[r];
          let mainPos = pad2;
          row.forEach((idx, j) => {
            const end = j === row.length - 1 ? pad2 + innerMain : mainPos + avail * aspects[idx] / rowAspect[r];
            const len = Math.max(1, Math.round(end) - Math.round(mainPos));
            const it = items[idx];
            cells.push({
              key: `justify-${it.slot}`,
              order: it.slot,
              slot: it.slot,
              left: horizontal ? Math.round(mainPos) : crossPos,
              top: horizontal ? crossPos : Math.round(mainPos),
              width: horizontal ? len : rh,
              height: horizontal ? rh : len,
              fit: "cover",
              position: layout.defaultPosition
            });
            mainPos = end + gap;
          });
          crossPos += rh + gap;
        });
        const main = Math.min(MAX_SIDE, Math.round(innerMain + pad2 * 2));
        const cross = Math.min(MAX_SIDE, fixedCross && fixedMain ? fixedCross : crossPos - gap + pad2);
        return {
          width: horizontal ? main : cross,
          height: horizontal ? cross : main,
          cells
        };
      }
      function cloneLayout(layout, name) {
        const copy = JSON.parse(JSON.stringify(layout));
        copy.id = uid();
        copy.builtin = false;
        copy.name = name ?? `${layout.name} \u526F\u672C`;
        if (copy.kind === "grid") copy.cells = copy.cells.map((c) => ({
          ...c,
          id: uid()
        }));
        return copy;
      }
      function envProblem() {
        if (!window.utools) return "\u672A\u68C0\u6D4B\u5230 uTools \u73AF\u5883\uFF08window.utools \u4E0D\u5B58\u5728\uFF09\uFF0C\u8BF7\u5728 uTools \u4E2D\u6253\u5F00\u63D2\u4EF6";
        if (!window.services) return window.__quickUnionPreload === "loading" ? "preload.js \u6267\u884C\u51FA\u9519\uFF0C\u8BF7\u6309 Ctrl/\u2318+Shift+I \u6253\u5F00\u5F00\u53D1\u8005\u5DE5\u5177\u67E5\u770B\u63A7\u5236\u53F0\u9519\u8BEF" : "preload.js \u672A\u52A0\u8F7D\uFF1A\u8BF7\u786E\u8BA4\u5BFC\u5165\u7684\u662F\u6784\u5EFA\u76EE\u5F55 dist/plugin.json\uFF0C\u4E14 dist \u4E2D\u6709 preload.js";
        return null;
      }
      function services() {
        const problem = envProblem();
        if (problem) throw new Error(problem);
        return window.services;
      }
      function utools2() {
        if (!window.utools) throw new Error("\u5F53\u524D\u4E0D\u5728 uTools \u73AF\u5883\u4E2D");
        return window.utools;
      }
      var TRAY_THUMB = 1280;
      async function mapLimit(list, limit, fn) {
        const out = new Array(list.length);
        let next = 0;
        const worker = async () => {
          while (next < list.length) {
            const i = next++;
            out[i] = await fn(list[i], i);
          }
        };
        await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
        return out;
      }
      var MIME = {
        svg: "image/svg+xml",
        bmp: "image/bmp",
        ico: "image/x-icon",
        gif: "image/gif",
        webp: "image/webp",
        avif: "image/avif",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg"
      };
      async function browserDecode(srcPath, name, thumbSize) {
        const svc = services();
        const bytes = await svc.readFileBytes(srcPath);
        const ext = srcPath.split(".").pop()?.toLowerCase() ?? "";
        const url = URL.createObjectURL(new Blob([bytes], { type: MIME[ext] ?? "application/octet-stream" }));
        try {
          const img = new Image();
          img.src = url;
          await img.decode();
          const w = img.naturalWidth || 512;
          const h = img.naturalHeight || 512;
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
          if (!blob) throw new Error("\u6D4F\u89C8\u5668\u89E3\u7801\u5931\u8D25");
          return {
            ...await svc.importBytes(new Uint8Array(await blob.arrayBuffer()), name, thumbSize),
            srcPath
          };
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      async function importPaths(paths, opts = {}) {
        const svc = services();
        const files = svc.expandPaths(paths, opts.recursive);
        const thumbSize = opts.thumbSize ?? 1280;
        const failed = [];
        let done = 0;
        return {
          images: (await mapLimit(files, 3, async (file) => {
            try {
              const r = await svc.importFile(file, thumbSize);
              if ("needsBrowserDecode" in r) return await browserDecode(r.srcPath, r.name, thumbSize);
              return r;
            } catch (err) {
              failed.push({
                path: file,
                reason: err instanceof Error ? err.message : String(err)
              });
              return null;
            } finally {
              done++;
              opts.onProgress?.(done, files.length);
            }
          })).filter((x) => !!x),
          failed
        };
      }
      var LAYOUT_PREFIX = "layout/";
      var WORKFLOW_PREFIX = "workflow/";
      function db() {
        return window.utools?.db;
      }
      function putDoc(id, data) {
        const d = db();
        if (!d) {
          localStorage.setItem(id, JSON.stringify(data));
          return;
        }
        const old = d.get(id);
        const res = d.put({
          _id: id,
          _rev: old?._rev,
          data
        });
        if (res.error) throw new Error(res.message || "\u4FDD\u5B58\u5931\u8D25");
      }
      function removeDoc(id) {
        const d = db();
        if (!d) {
          localStorage.removeItem(id);
          return;
        }
        d.remove(id);
      }
      function listDocs(prefix) {
        const d = db();
        if (!d) {
          const out = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k?.startsWith(prefix)) try {
              out.push(JSON.parse(localStorage.getItem(k)));
            } catch {
            }
          }
          return out;
        }
        return d.allDocs(prefix).map((doc) => doc.data).filter(Boolean);
      }
      var byTime = (a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0);
      var layoutStore = {
        list: () => listDocs(LAYOUT_PREFIX).sort(byTime),
        save: (layout) => putDoc(LAYOUT_PREFIX + layout.id, {
          ...layout,
          builtin: false,
          updatedAt: Date.now()
        }),
        remove: (id) => removeDoc(LAYOUT_PREFIX + id)
      };
      var workflowStore = {
        list: () => listDocs(WORKFLOW_PREFIX).sort(byTime),
        save: (wf) => putDoc(WORKFLOW_PREFIX + wf.id, {
          ...wf,
          updatedAt: Date.now()
        }),
        remove: (id) => removeDoc(WORKFLOW_PREFIX + id)
      };
      function buildStitchJob(layout, images, name, thumbSize) {
        const resolved = resolveLayout(layout, images);
        const W = resolved.width;
        const H = resolved.height;
        const cells = [];
        for (const c of resolved.cells) {
          const left = Math.max(0, Math.min(W - 1, c.left));
          const top = Math.max(0, Math.min(H - 1, c.top));
          const width = Math.max(1, Math.min(c.width, W - left));
          const height = Math.max(1, Math.min(c.height, H - top));
          const img = images[c.slot];
          cells.push({
            left,
            top,
            width,
            height,
            image: img?.path ?? null,
            fit: c.fit,
            position: c.position,
            background: c.background,
            radius: layout.radius
          });
        }
        return {
          name,
          width: W,
          height: H,
          background: layout.background,
          cells,
          thumbSize
        };
      }
      var STEP_LABEL = {
        edit: "\u7F16\u8F91",
        stitch: "\u62FC\u63A5",
        export: "\u5BFC\u51FA"
      };
      function newStep(type, defaultPresetId) {
        if (type === "edit") return {
          id: uid(),
          type,
          op: {
            type: "resize",
            mode: "scale",
            scale: 0.5
          }
        };
        if (type === "stitch") return {
          id: uid(),
          type,
          presetId: defaultPresetId,
          overflow: "chunk",
          remainder: "keep",
          sort: "none"
        };
        return {
          id: uid(),
          type,
          format: "png",
          quality: 90,
          target: "source",
          customDir: "",
          subDir: "",
          nameTemplate: "{name}",
          copyToClipboard: false,
          openFolder: true
        };
      }
      function describeOp(op) {
        switch (op.type) {
          case "rotate":
            return `\u65CB\u8F6C ${op.angle}\xB0`;
          case "flip":
            return [op.horizontal && "\u6C34\u5E73", op.vertical && "\u5782\u76F4"].filter(Boolean).join("+") + "\u7FFB\u8F6C";
          case "crop":
            return `\u88C1\u5207 ${Math.round(op.w * 100)}%\xD7${Math.round(op.h * 100)}%`;
          case "cropRatio":
            return `\u6309 ${op.ratioW}:${op.ratioH} \u88C1\u5207`;
          case "trim":
            return "\u53BB\u9664\u7EAF\u8272\u8FB9";
          case "resize":
            if (op.mode === "scale") return `\u7F29\u653E ${Math.round(op.scale * 100)}%`;
            if (op.mode === "width") return `\u5BBD\u5EA6 ${op.width}px`;
            if (op.mode === "height") return `\u9AD8\u5EA6 ${op.height}px`;
            if (op.mode === "maxSide") return `\u6700\u957F\u8FB9 ${op.size}px`;
            return `\u5C3A\u5BF8 ${op.width}\xD7${op.height}`;
        }
      }
      function pad(n, width) {
        return String(n).padStart(width, "0");
      }
      function fileName(template, name, index, total) {
        const now = /* @__PURE__ */ new Date();
        const date = `${now.getFullYear()}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}`;
        const time = `${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}${pad(now.getSeconds(), 2)}`;
        return (template || "{name}").replaceAll("{name}", name).replaceAll("{index}", pad(index + 1, String(total).length)).replaceAll("{date}", date).replaceAll("{time}", time);
      }
      function sortItems(list, sort) {
        if (sort === "none") return list;
        const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, void 0, {
          numeric: true,
          sensitivity: "base"
        }));
        return sort === "nameDesc" ? sorted.reverse() : sorted;
      }
      async function runWorkflow(wf, input, layouts, onProgress) {
        const svc = services();
        const failed = [];
        let list = [];
        if (input.paths.length) {
          onProgress("\u5BFC\u5165\u56FE\u7247\u2026");
          const res = await importPaths(input.paths, {
            recursive: wf.recursive,
            thumbSize: TRAY_THUMB,
            onProgress: (d, t) => onProgress(`\u5BFC\u5165\u56FE\u7247 ${d}/${t}`)
          });
          failed.push(...res.failed);
          list.push(...res.images.map((r) => ({
            ...r,
            srcDir: r.srcPath ? svc.dirname(r.srcPath) : ""
          })));
        }
        if (input.dataUrl) {
          const r = await svc.importDataUrl(input.dataUrl, "\u7C98\u8D34\u7684\u56FE\u7247", TRAY_THUMB);
          list.push({
            ...r,
            srcDir: ""
          });
        }
        for (const r of input.images ?? []) list.push({
          ...r,
          srcDir: r.srcPath ? svc.dirname(r.srcPath) : ""
        });
        if (!list.length) throw new Error("\u6CA1\u6709\u53EF\u5904\u7406\u7684\u56FE\u7247");
        const exported = [];
        const steps = wf.steps;
        for (let s = 0; s < steps.length; s++) {
          const step = steps[s];
          const tag = `\u6B65\u9AA4 ${s + 1}/${steps.length} ${STEP_LABEL[step.type]}`;
          if (step.type === "edit") {
            const ops = [step.op];
            while (steps[s + 1]?.type === "edit") ops.push(steps[++s].op);
            const next = [];
            for (let i = 0; i < list.length; i++) {
              onProgress(`${tag} ${i + 1}/${list.length}`);
              const it = list[i];
              const r = await svc.applyOps(it.path, ops, it.name, TRAY_THUMB);
              next.push({
                ...r,
                srcPath: it.srcPath,
                srcDir: it.srcDir
              });
            }
            list = next;
          } else if (step.type === "stitch") {
            const layout = layouts.find((l) => l.id === step.presetId);
            if (!layout) throw new Error(`${tag}\uFF1A\u627E\u4E0D\u5230\u7F51\u683C\u9884\u8BBE\uFF0C\u53EF\u80FD\u5DF2\u88AB\u5220\u9664`);
            const sorted = sortItems(list, step.sort);
            const per = slotCount(layout) || sorted.length;
            const groups = [];
            if (step.overflow === "first") groups.push(sorted.slice(0, per));
            else for (let i = 0; i < sorted.length; i += per) groups.push(sorted.slice(i, i + per));
            if (step.remainder === "drop" && groups.length > 1 && groups[groups.length - 1].length < per) groups.pop();
            const next = [];
            for (let g = 0; g < groups.length; g++) {
              onProgress(`${tag} ${g + 1}/${groups.length}`);
              const group = groups[g];
              const name = groups.length > 1 ? `${group[0].name}-\u62FC\u56FE${g + 1}` : `${group[0].name}-\u62FC\u56FE`;
              const r = await svc.stitch(buildStitchJob(layout, group, name, TRAY_THUMB));
              next.push({
                ...r,
                srcPath: group[0].srcPath,
                srcDir: group[0].srcDir
              });
            }
            list = next;
          } else exported.push(...await runExport(step, list, (i) => onProgress(`${tag} ${i}/${list.length}`)));
        }
        return {
          outputs: list,
          exported,
          failed
        };
      }
      var askedDir = null;
      function resolveDir(step, item) {
        const u = utools2();
        let dir;
        if (step.target === "custom" && step.customDir) dir = step.customDir;
        else if (step.target === "source" && item.srcDir) dir = item.srcDir;
        else if (step.target === "ask" && askedDir) dir = askedDir;
        else dir = u.getPath("downloads");
        return step.subDir ? services().join(dir, step.subDir) : dir;
      }
      async function runExport(step, list, progress) {
        const svc = services();
        const u = utools2();
        askedDir = null;
        if (step.target === "ask") {
          const picked = u.showOpenDialog({
            title: "\u9009\u62E9\u5BFC\u51FA\u76EE\u5F55",
            properties: ["openDirectory", "createDirectory"]
          });
          if (!picked?.length) throw new Error("\u5DF2\u53D6\u6D88\u5BFC\u51FA");
          askedDir = picked[0];
        }
        const out = [];
        for (let i = 0; i < list.length; i++) {
          progress(i + 1);
          const it = list[i];
          const target = await svc.exportToDir(it.path, resolveDir(step, it), fileName(step.nameTemplate, it.name, i, list.length), step.format, step.quality);
          out.push(target);
        }
        if (step.copyToClipboard && out.length) {
          if (out.length === 1) u.copyImage(out[0]);
          else u.copyFile(out);
        }
        if (step.openFolder && out.length) u.shellShowItemInFolder(out[0]);
        return out;
      }
      var FORMATS = [
        "png",
        "jpeg",
        "webp",
        "avif"
      ];
      var DEFAULT_LAYOUT = "builtin-justify-h";
      var OP_FIELDS = {
        rotate: ["angle"],
        flip: [],
        crop: [
          "x",
          "y",
          "w",
          "h"
        ],
        cropRatio: ["ratioW", "ratioH"],
        trim: [],
        "resize:scale": ["scale"],
        "resize:width": ["width"],
        "resize:height": ["height"],
        "resize:maxSide": ["size"],
        "resize:box": ["width", "height"]
      };
      function checkOps(ops) {
        if (!Array.isArray(ops) || !ops.length) throw new Error("ops \u4E0D\u80FD\u4E3A\u7A7A");
        return ops.map((raw, i) => {
          const op = { ...raw };
          const key = op.type === "resize" ? `resize:${op.mode}` : String(op.type);
          const fields = OP_FIELDS[key];
          if (!fields) throw new Error(`ops[${i}]\uFF1A\u4E0D\u652F\u6301\u7684\u64CD\u4F5C ${key}`);
          const missing = fields.filter((f) => op[f] === void 0);
          if (missing.length) throw new Error(`ops[${i}]\uFF08${key}\uFF09\u7F3A\u5C11\u5B57\u6BB5\uFF1A${missing.join(", ")}`);
          if (op.type === "flip") {
            op.horizontal = !!op.horizontal;
            op.vertical = !!op.vertical;
          }
          if (op.type === "cropRatio") op.position ?? (op.position = "center");
          if (op.type === "trim") op.threshold ?? (op.threshold = 10);
          if (key === "resize:box") {
            op.fit ?? (op.fit = "cover");
            op.position ?? (op.position = "center");
          }
          return op;
        });
      }
      function allLayouts() {
        return [...BUILTIN_LAYOUTS, ...layoutStore.list()];
      }
      function requirePaths(params) {
        const all = Array.isArray(params.paths) ? params.paths.filter((p) => typeof p === "string" && p) : [];
        if (!all.length) throw new Error("paths \u4E0D\u80FD\u4E3A\u7A7A\uFF1A\u8BF7\u4F20\u5165\u56FE\u7247\u6587\u4EF6\u6216\u6587\u4EF6\u5939\u7684\u7EDD\u5BF9\u8DEF\u5F84");
        const svc = services();
        const paths = all.filter((p) => svc.exists(p));
        const missing = all.filter((p) => !svc.exists(p)).map((path) => ({
          path,
          reason: "\u6587\u4EF6\u6216\u6587\u4EF6\u5939\u4E0D\u5B58\u5728"
        }));
        if (!paths.length) throw new Error(`\u8DEF\u5F84\u90FD\u4E0D\u5B58\u5728\uFF1A${all.slice(0, 3).join("\u3001")}${all.length > 3 ? " \u7B49" : ""}\uFF08\u9700\u8981\u7EDD\u5BF9\u8DEF\u5F84\uFF09`);
        return {
          paths,
          missing
        };
      }
      function exportStep(params, defaultName) {
        const step = newStep("export", "");
        if (params.format !== void 0 && !FORMATS.includes(params.format)) throw new Error(`format \u53EA\u80FD\u662F ${FORMATS.join(" / ")}`);
        step.format = params.format ?? "png";
        step.quality = params.quality ?? 90;
        step.target = params.output_dir ? "custom" : "source";
        step.customDir = params.output_dir ?? "";
        step.nameTemplate = params.name_template || defaultName;
        step.openFolder = false;
        return step;
      }
      function progressReporter(ctx) {
        let n = 0;
        return (message) => {
          n += 1;
          ctx?.sendProgress?.({
            progress: n,
            message
          }).catch(() => {
          });
        };
      }
      function summarize(res) {
        const sized = res.exported.length === res.outputs.length;
        return {
          files: res.exported.map((path, i) => sized ? {
            path,
            width: res.outputs[i].width,
            height: res.outputs[i].height
          } : { path }),
          failed: res.failed
        };
      }
      async function run(steps, input, recursive, layouts, ctx) {
        const res = await runWorkflow({
          id: "mcp",
          name: "MCP",
          steps,
          registerFeature: false,
          recursive
        }, { paths: input.paths }, layouts, progressReporter(ctx));
        return summarize({
          ...res,
          failed: [...input.missing, ...res.failed]
        });
      }
      function layoutInfo(l) {
        const slots = slotCount(l);
        const base = {
          id: l.id,
          name: l.name,
          builtin: !!l.builtin,
          kind: l.kind,
          images_per_output: slots || "all"
        };
        if (l.kind === "grid") return {
          ...base,
          cells: l.cells.length,
          size: l.sizeMode === "fixed" ? `${l.width}x${l.height}` : `width ${l.width}, auto height`
        };
        return {
          ...base,
          direction: l.direction
        };
      }
      function workflowInfo(w, layouts) {
        return {
          id: w.id,
          name: w.name,
          steps: w.steps.map((s) => {
            if (s.type === "edit") return `${STEP_LABEL.edit}\uFF1A${describeOp(s.op)}`;
            if (s.type === "stitch") return `${STEP_LABEL.stitch}\uFF1A${layouts.find((l) => l.id === s.presetId)?.name ?? "\u9884\u8BBE\u5DF2\u5220\u9664"}`;
            return `${STEP_LABEL.export}\uFF1A${s.format}`;
          })
        };
      }
      function withOverrides(layout, params) {
        const keys = [
          "gap",
          "padding",
          "radius",
          "background"
        ];
        const sizeKeys = ["width", "height"];
        if (![...keys, ...sizeKeys].some((k) => params[k] !== void 0)) return layout;
        const l = cloneLayout(layout, layout.name);
        for (const k of keys) if (params[k] !== void 0) l[k] = params[k];
        if (l.kind === "grid") {
          if (params.width !== void 0) l.width = params.width;
          if (params.height !== void 0) {
            l.height = params.height;
            l.sizeMode = "fixed";
          }
        } else if (l.kind === "justify") {
          if (params.width !== void 0) l.width = params.width;
          if (params.height !== void 0) l.height = params.height;
        } else {
          const size = l.direction === "vertical" ? params.width : params.height;
          if (size !== void 0) l.size = size;
        }
        return l;
      }
      function registerMcpTools(api) {
        api.registerTool("list_presets", () => {
          const layouts = allLayouts();
          return {
            layouts: layouts.map(layoutInfo),
            workflows: workflowStore.list().map((w) => workflowInfo(w, layouts))
          };
        });
        api.registerTool("edit_images", async (params, ctx) => {
          const paths = requirePaths(params);
          return run([...checkOps(params.ops).map((op) => ({
            ...newStep("edit", ""),
            op
          })), exportStep(params, "{name}-\u7F16\u8F91")], paths, !!params.recursive, allLayouts(), ctx);
        });
        api.registerTool("stitch_images", async (params, ctx) => {
          const paths = requirePaths(params);
          const layouts = allLayouts();
          const presetId = params.preset_id || DEFAULT_LAYOUT;
          const preset = layouts.find((l) => l.id === presetId || l.name === presetId);
          if (!preset) throw new Error(`\u627E\u4E0D\u5230\u7F51\u683C\u9884\u8BBE\u300C${presetId}\u300D\uFF0C\u53EF\u4EE5\u5148\u8C03\u7528 list_presets \u67E5\u770B`);
          const layout = withOverrides(preset, params);
          const stitch = newStep("stitch", layout.id);
          stitch.overflow = params.overflow === "first" ? "first" : "chunk";
          stitch.remainder = params.remainder === "drop" ? "drop" : "keep";
          stitch.sort = params.sort === "name" || params.sort === "nameDesc" ? params.sort : "none";
          return run([stitch, exportStep(params, "{name}")], paths, !!params.recursive, layout === preset ? layouts : [...layouts, layout], ctx);
        });
        api.registerTool("run_workflow", async (params, ctx) => {
          const paths = requirePaths(params);
          const key = params.workflow;
          const wf = workflowStore.list().find((w) => w.id === key || w.name === key);
          if (!wf) throw new Error(`\u627E\u4E0D\u5230\u5DE5\u4F5C\u6D41\u300C${key}\u300D\uFF0C\u53EF\u4EE5\u5148\u8C03\u7528 list_presets \u67E5\u770B`);
          const steps = wf.steps.map((s) => {
            if (s.type !== "export") return s;
            const target = params.output_dir ? "custom" : s.target === "ask" ? "downloads" : s.target;
            return {
              ...s,
              target,
              customDir: params.output_dir ?? s.customDir,
              openFolder: false
            };
          });
          if (!steps.some((s) => s.type === "export")) throw new Error("\u8FD9\u4E2A\u5DE5\u4F5C\u6D41\u6CA1\u6709\u5BFC\u51FA\u6B65\u9AA4\uFF0C\u4E0D\u4F1A\u4EA7\u751F\u6587\u4EF6");
          return run(steps, paths, params.recursive ?? wf.recursive, allLayouts(), ctx);
        });
      }
      exports.registerMcpTools = registerMcpTools;
    }
  });

  // ../../utools-quick-union-image/dist/preload.js
  var require_preload = __commonJS({
    "../../utools-quick-union-image/dist/preload.js"() {
      var fs = require_node_fs();
      var fsp = require_promises();
      var path = require_node_path();
      window.__quickUnionPreload = "loading";
      function electron() {
        return require_electron();
      }
      var IMAGE_EXTS = [
        "png",
        "jpg",
        "jpeg",
        "jfif",
        "pjpeg",
        "webp",
        "gif",
        "bmp",
        "tif",
        "tiff",
        "avif",
        "heic",
        "heif",
        "svg",
        "ico"
      ];
      var seq = 0;
      var workDirCache = null;
      function ensureDir(dir) {
        if (fs.existsSync(dir)) return;
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch (err) {
          if (!(err && err.code === "EEXIST")) throw err;
        }
      }
      var tempRootCache = null;
      function tempRoot() {
        if (tempRootCache) return tempRootCache;
        for (let i = 0; i < 3 && !tempRootCache; i++) {
          try {
            tempRootCache = utools.getPluginTempPath();
          } catch (err) {
            if (!(err && err.code === "EEXIST")) throw err;
            if (err.path && fs.existsSync(err.path)) tempRootCache = err.path;
          }
        }
        if (!tempRootCache) throw new Error("\u65E0\u6CD5\u83B7\u53D6\u63D2\u4EF6\u4E34\u65F6\u76EE\u5F55");
        return tempRootCache;
      }
      function workDir() {
        const dir = path.join(tempRoot(), "work");
        if (workDirCache !== dir || !fs.existsSync(dir)) {
          ensureDir(dir);
          workDirCache = dir;
        }
        return dir;
      }
      function safeName(name) {
        return String(name || "image").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 80) || "image";
      }
      function tempFile(name, ext) {
        seq += 1;
        return path.join(workDir(), `${Date.now().toString(36)}-${seq}-${safeName(name)}.${ext}`);
      }
      function isImagePath(p) {
        const ext = path.extname(p).slice(1).toLowerCase();
        return IMAGE_EXTS.includes(ext);
      }
      function sharp(input, options) {
        if (input && typeof input === "object" && !ArrayBuffer.isView(input) && !(input instanceof ArrayBuffer) && !Array.isArray(input)) {
          return utools.sharp(input);
        }
        return utools.sharp(input, { failOn: "none", limitInputPixels: false, ...options });
      }
      function autoOrient(s) {
        return typeof s.autoOrient === "function" ? s.autoOrient() : s.rotate();
      }
      async function thumbnail(filePath, size) {
        const buf = await sharp(filePath).resize(size, size, { fit: "inside", withoutEnlargement: true }).webp({ quality: 92, smartSubsample: true }).toBuffer();
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      }
      async function describe(pngPath, srcPath, name, thumbSize) {
        const meta = await sharp(pngPath).metadata();
        return {
          path: pngPath,
          srcPath: srcPath || "",
          name,
          width: meta.width,
          height: meta.height,
          thumb: await thumbnail(pngPath, thumbSize || 512)
        };
      }
      async function normalizeToPng(input, name) {
        const out = tempFile(name, "png");
        await autoOrient(sharp(input)).png({ compressionLevel: 3 }).toFile(out);
        return out;
      }
      async function toRaw(s) {
        const { data, info } = await s.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        return { data, info: { width: info.width, height: info.height, channels: info.channels } };
      }
      function fromRaw(state) {
        return sharp(state.data, { raw: state.info });
      }
      function parseColor(c, fallback) {
        if (!c) return fallback;
        if (typeof c === "object") return c;
        if (c === "transparent") return { r: 0, g: 0, b: 0, alpha: 0 };
        return c;
      }
      var POS_FACTOR = {
        center: [0.5, 0.5],
        top: [0.5, 0],
        bottom: [0.5, 1],
        left: [0, 0.5],
        right: [1, 0.5],
        "left top": [0, 0],
        "right top": [1, 0],
        "left bottom": [0, 1],
        "right bottom": [1, 1]
      };
      function clampInt(v, min, max) {
        return Math.max(min, Math.min(max, Math.round(v)));
      }
      async function applyOp(state, op) {
        const { width: W, height: H } = state.info;
        switch (op.type) {
          case "rotate": {
            const angle = Number(op.angle) || 0;
            if (angle % 360 === 0) return state;
            return toRaw(fromRaw(state).rotate(angle, { background: parseColor(op.background, { r: 0, g: 0, b: 0, alpha: 0 }) }));
          }
          case "flip": {
            if (!op.horizontal && !op.vertical) return state;
            let s = fromRaw(state);
            if (op.vertical) s = s.flip();
            if (op.horizontal) s = s.flop();
            return toRaw(s);
          }
          case "crop": {
            const left = clampInt(op.x * W, 0, W - 1);
            const top = clampInt(op.y * H, 0, H - 1);
            const width = clampInt(op.w * W, 1, W - left);
            const height = clampInt(op.h * H, 1, H - top);
            if (left === 0 && top === 0 && width === W && height === H) return state;
            return toRaw(fromRaw(state).extract({ left, top, width, height }));
          }
          case "cropRatio": {
            const ratio = op.ratioW / op.ratioH;
            if (!(ratio > 0)) return state;
            let width = W;
            let height = Math.round(W / ratio);
            if (height > H) {
              height = H;
              width = Math.round(H * ratio);
            }
            const [fx, fy] = POS_FACTOR[op.position] || POS_FACTOR.center;
            const left = Math.round((W - width) * fx);
            const top = Math.round((H - height) * fy);
            return toRaw(fromRaw(state).extract({ left, top, width: Math.max(1, width), height: Math.max(1, height) }));
          }
          case "trim": {
            try {
              return await toRaw(fromRaw(state).trim({ threshold: Number(op.threshold) || 10 }));
            } catch {
              return state;
            }
          }
          case "resize": {
            let w = null;
            let h = null;
            const opts = { fit: "fill" };
            if (op.mode === "scale") {
              const k = Number(op.scale) || 1;
              if (k === 1) return state;
              w = Math.max(1, Math.round(W * k));
              h = Math.max(1, Math.round(H * k));
            } else if (op.mode === "width") {
              w = Math.max(1, Math.round(op.width));
              h = Math.max(1, Math.round(H * w / W));
            } else if (op.mode === "height") {
              h = Math.max(1, Math.round(op.height));
              w = Math.max(1, Math.round(W * h / H));
            } else if (op.mode === "maxSide") {
              const k = op.size / Math.max(W, H);
              if (k >= 1 && op.onlyShrink) return state;
              w = Math.max(1, Math.round(W * k));
              h = Math.max(1, Math.round(H * k));
            } else if (op.mode === "box") {
              w = Math.max(1, Math.round(op.width));
              h = Math.max(1, Math.round(op.height));
              opts.fit = op.fit || "cover";
              opts.position = op.position || "center";
              opts.background = parseColor(op.background, { r: 0, g: 0, b: 0, alpha: 0 });
            } else {
              return state;
            }
            if (w === W && h === H && opts.fit === "fill") return state;
            return toRaw(fromRaw(state).resize(w, h, opts));
          }
          default:
            throw new Error(`\u672A\u77E5\u7684\u7F16\u8F91\u64CD\u4F5C: ${op.type}`);
        }
      }
      async function runOps(inputPath, ops) {
        let state = await toRaw(sharp(inputPath));
        for (const op of ops || []) state = await applyOp(state, op);
        return state;
      }
      var TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
      async function renderCell(cell) {
        const w = Math.max(1, Math.round(cell.width));
        const h = Math.max(1, Math.round(cell.height));
        const bg = parseColor(cell.background, TRANSPARENT);
        const layers = [];
        if (cell.image) {
          if (cell.fit === "none") {
            const meta = await sharp(cell.image).metadata();
            const [fx, fy] = POS_FACTOR[cell.position] || POS_FACTOR.center;
            const cw = Math.min(meta.width, w);
            const ch = Math.min(meta.height, h);
            const region = await sharp(cell.image).extract({ left: Math.round((meta.width - cw) * fx), top: Math.round((meta.height - ch) * fy), width: cw, height: ch }).ensureAlpha().png().toBuffer();
            layers.push({ input: region, left: Math.round((w - cw) * fx), top: Math.round((h - ch) * fy) });
          } else {
            const resized = await sharp(cell.image).ensureAlpha().resize(w, h, { fit: cell.fit || "cover", position: cell.position || "center", background: TRANSPARENT }).png().toBuffer();
            layers.push({ input: resized, left: 0, top: 0 });
          }
        }
        if (cell.radius > 0) {
          const r = Math.min(cell.radius, w / 2, h / 2);
          layers.push({
            input: Buffer.from(`<svg width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`),
            blend: "dest-in"
          });
        }
        const buf = await sharp({ create: { width: w, height: h, channels: 4, background: bg } }).composite(layers).png().toBuffer();
        return { input: buf, left: Math.round(cell.left), top: Math.round(cell.top) };
      }
      async function stitch(job) {
        const width = Math.max(1, Math.round(job.width));
        const height = Math.max(1, Math.round(job.height));
        const overlays = [];
        for (const cell of job.cells) {
          const hasBg = cell.background && cell.background !== "transparent";
          if (cell.image || hasBg) overlays.push(await renderCell(cell));
        }
        const out = tempFile(job.name || "stitch", "png");
        await sharp({ create: { width, height, channels: 4, background: parseColor(job.background, "#ffffff") } }).composite(overlays).png({ compressionLevel: 6 }).toFile(out);
        return describe(out, "", job.name || "stitch", job.thumbSize);
      }
      function uniquePath(p) {
        if (!fs.existsSync(p)) return p;
        const dir = path.dirname(p);
        const ext = path.extname(p);
        const base = path.basename(p, ext);
        for (let i = 1; i < 1e4; i++) {
          const candidate = path.join(dir, `${base} (${i})${ext}`);
          if (!fs.existsSync(candidate)) return candidate;
        }
        return path.join(dir, `${base}-${Date.now()}${ext}`);
      }
      function formatFromExt(p) {
        const ext = path.extname(p).slice(1).toLowerCase();
        if (ext === "jpg" || ext === "jpeg") return "jpeg";
        if (ext === "webp") return "webp";
        if (ext === "avif") return "avif";
        return "png";
      }
      async function writeFormat(srcPath, target, format, quality, background) {
        let s = sharp(srcPath);
        const q = Math.max(1, Math.min(100, Number(quality) || 90));
        if (format === "jpeg") s = s.flatten({ background: background || "#ffffff" }).jpeg({ quality: q, mozjpeg: true });
        else if (format === "webp") s = s.webp({ quality: q });
        else if (format === "avif") s = s.avif({ quality: q });
        else s = s.png({ compressionLevel: 9 });
        await s.toFile(target);
        return target;
      }
      var EXT_OF = { png: "png", jpeg: "jpg", webp: "webp", avif: "avif" };
      var infoCache = /* @__PURE__ */ new Map();
      function hex(n) {
        return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
      }
      async function imageInfo(workPath, srcPath, withStats) {
        const key = `${workPath}|${withStats ? 1 : 0}`;
        if (infoCache.has(key)) return infoCache.get(key);
        const origin = srcPath && fs.existsSync(srcPath) ? srcPath : workPath;
        const meta = await sharp(origin).metadata();
        const info = {
          format: meta.format || path.extname(origin).slice(1).toLowerCase(),
          fileSize: fs.statSync(origin).size,
          hasAlpha: !!meta.hasAlpha,
          frames: meta.pages || 1,
          generated: origin === workPath
        };
        if (withStats) {
          const st = await sharp(workPath).stats();
          info.isOpaque = st.isOpaque;
          info.dominantColor = `#${hex(st.dominant.r)}${hex(st.dominant.g)}${hex(st.dominant.b)}`;
          info.sharpness = Math.round(st.sharpness * 100) / 100;
          info.brightness = Math.round(st.channels.slice(0, 3).reduce((a, c) => a + c.mean, 0) / Math.min(3, st.channels.length));
        }
        infoCache.set(key, info);
        return info;
      }
      window.services = {
        imageExtensions: IMAGE_EXTS,
        // 界面缩放（整页缩放，坐标与布局保持一致）
        getZoomFactor() {
          return electron().webFrame.getZoomFactor();
        },
        setZoomFactor(factor) {
          electron().webFrame.setZoomFactor(Math.max(0.8, Math.min(2, Number(factor) || 1)));
        },
        isImagePath,
        getPathForFile(file) {
          return electron().webUtils.getPathForFile(file);
        },
        // 展开文件 / 文件夹为图片路径列表（文件夹按文件名自然排序）
        expandPaths(paths, recursive) {
          const result = [];
          const walk = (dir, depth) => {
            let entries = [];
            try {
              entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
              return;
            }
            entries.sort((a, b) => a.name.localeCompare(b.name, void 0, { numeric: true, sensitivity: "base" }));
            for (const e of entries) {
              if (e.name.startsWith(".")) continue;
              const full = path.join(dir, e.name);
              if (e.isDirectory()) {
                if (recursive && depth < 8) walk(full, depth + 1);
              } else if (isImagePath(full)) {
                result.push(full);
              }
            }
          };
          for (const p of paths) {
            let stat;
            try {
              stat = fs.statSync(p);
            } catch {
              continue;
            }
            if (stat.isDirectory()) walk(p, 0);
            else if (isImagePath(p)) result.push(p);
          }
          return result;
        },
        // 导入单张图片：sharp 解码 → 失败时用 Electron nativeImage → 仍失败则交给前端用浏览器解码
        async importFile(filePath, thumbSize) {
          const name = path.basename(filePath, path.extname(filePath));
          let pngPath = null;
          try {
            pngPath = await normalizeToPng(filePath, name);
          } catch (err) {
            const img = electron().nativeImage.createFromPath(filePath);
            if (!img.isEmpty()) {
              pngPath = await normalizeToPng(img.toPNG(), name);
            } else {
              return { needsBrowserDecode: true, srcPath: filePath, name, error: String(err && err.message) };
            }
          }
          return describe(pngPath, filePath, name, thumbSize);
        },
        async importBytes(bytes, name, thumbSize) {
          const pngPath = await normalizeToPng(Buffer.from(bytes), name);
          return describe(pngPath, "", name, thumbSize);
        },
        async importDataUrl(dataUrl, name, thumbSize) {
          const base64 = String(dataUrl).replace(/^data:[^,]*,/, "");
          const pngPath = await normalizeToPng(Buffer.from(base64, "base64"), name || "pasted");
          return describe(pngPath, "", name || "pasted", thumbSize);
        },
        // 能否读取（macOS 沙盒应用的私有目录会 EPERM）；目录视为可读
        canRead(p) {
          try {
            if (fs.statSync(p).isDirectory()) return true;
            fs.closeSync(fs.openSync(p, "r"));
            return true;
          } catch {
            return false;
          }
        },
        // 剪贴板中的位图（截图、微信等沙盒应用复制的图片）；没有时返回 null
        readClipboardImage() {
          const img = electron().clipboard.readImage();
          if (!img || img.isEmpty()) return null;
          const buf = img.toPNG();
          return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        },
        async readFileBytes(filePath) {
          const buf = await fsp.readFile(filePath);
          return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        },
        async thumbnail(filePath, size) {
          return thumbnail(filePath, size);
        },
        // 编辑预览：返回限制尺寸的结果图
        async previewOps(filePath, ops, maxSize) {
          const state = await runOps(filePath, ops);
          const buf = await fromRaw(state).resize(maxSize, maxSize, { fit: "inside", withoutEnlargement: true }).webp({ quality: 92, smartSubsample: true }).toBuffer();
          return {
            width: state.info.width,
            height: state.info.height,
            bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
          };
        },
        async applyOps(filePath, ops, name, thumbSize) {
          const state = await runOps(filePath, ops);
          const out = tempFile(name, "png");
          await fromRaw(state).png({ compressionLevel: 3 }).toFile(out);
          return describe(out, "", name, thumbSize);
        },
        stitch,
        imageInfo,
        // 导出到指定完整路径（格式由扩展名决定）
        async exportTo(srcPath, targetPath, quality) {
          const target = targetPath;
          ensureDir(path.dirname(target));
          return writeFormat(srcPath, target, formatFromExt(target), quality);
        },
        // 导出到目录，自动避免重名
        async exportToDir(srcPath, dir, baseName, format, quality) {
          ensureDir(dir);
          const fmt = EXT_OF[format] ? format : "png";
          const target = uniquePath(path.join(dir, `${safeName(baseName)}.${EXT_OF[fmt]}`));
          return writeFormat(srcPath, target, fmt, quality);
        },
        dirname(p) {
          return path.dirname(p);
        },
        basename(p, withExt) {
          return withExt ? path.basename(p) : path.basename(p, path.extname(p));
        },
        join(...parts) {
          return path.join(...parts);
        },
        exists(p) {
          return fs.existsSync(p);
        }
      };
      try {
        if (typeof utools.registerTool === "function") require_mcp_tools().registerMcpTools(utools);
      } catch (err) {
        console.error("[\u5FEB\u62FC\u56FE] MCP \u5DE5\u5177\u6CE8\u518C\u5931\u8D25", err);
      }
      window.__quickUnionPreload = "ok";
    }
  });
  require_preload();
})();
