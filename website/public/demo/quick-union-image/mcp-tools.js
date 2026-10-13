Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/lib/layout.ts
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
	const g = makeGrid(`${rows} 行 × ${cols} 列`, rows, cols, {
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
	builtinJustify("builtin-justify-h", "等高横拼", "horizontal", 1),
	builtinJustify("builtin-justify-v", "等宽竖拼", "vertical", 1),
	builtinJustify("builtin-justify-h2", "等高两行", "horizontal", 2),
	builtinJustify("builtin-justify-pair", "每两张等高横拼", "horizontal", 1, 2),
	builtinStrip("builtin-strip-v", "竖向长图", "vertical", 1),
	builtinStrip("builtin-strip-h", "横向长图", "horizontal", 1),
	builtinStrip("builtin-strip-v2", "双列瀑布", "vertical", 2),
	builtinGrid(1, 2),
	builtinGrid(2, 1),
	builtinGrid(1, 3),
	builtinGrid(3, 1),
	builtinGrid(2, 2),
	builtinGrid(2, 3),
	builtinGrid(3, 2),
	builtinGrid(3, 3),
	builtinGrid(4, 4),
	freeGrid("builtin-free-l1r2", "左一右二", [
		[
			0,
			0,
			.5,
			1
		],
		[
			.5,
			0,
			.5,
			.5
		],
		[
			.5,
			.5,
			.5,
			.5
		]
	]),
	freeGrid("builtin-free-l2r1", "左二右一", [
		[
			0,
			0,
			.5,
			.5
		],
		[
			0,
			.5,
			.5,
			.5
		],
		[
			.5,
			0,
			.5,
			1
		]
	]),
	freeGrid("builtin-free-t1b2", "上一下二", [
		[
			0,
			0,
			1,
			.5
		],
		[
			0,
			.5,
			.5,
			.5
		],
		[
			.5,
			.5,
			.5,
			.5
		]
	]),
	freeGrid("builtin-free-t1b3", "上一下三", [
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
	freeGrid("builtin-free-big5", "一大五小", [
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
	freeGrid("builtin-free-center", "中心九宫", [
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
/** 格子使用的图片序号：优先预设里的 index，否则按格子顺序 */
function cellIndex(cell, order) {
	return cell.index ?? order;
}
/** 该布局一次需要的图片数；0 表示不限（全部） */
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
	const pad = Math.max(0, layout.padding);
	const gap = Math.max(0, layout.gap);
	const W = Math.max(16, Math.round(layout.width));
	const innerW = Math.max(1, W - pad * 2);
	let H;
	if (layout.sizeMode === "fixed") H = Math.max(16, Math.round(layout.height));
	else {
		const candidates = [];
		layout.cells.forEach((cell, i) => {
			const img = images[cellIndex(cell, i)];
			if (img && img.width > 0 && cell.h > 0) candidates.push(cell.w * innerW * img.height / (cell.h * img.width));
		});
		const innerH = candidates.length ? median(candidates) : layout.rows && layout.cols ? innerW * layout.rows / layout.cols : innerW;
		H = Math.round(Math.min(MAX_SIDE, innerH + pad * 2));
	}
	const innerH = Math.max(1, H - pad * 2);
	const cells = layout.cells.map((cell, i) => {
		const x0 = pad + cell.x * innerW + (cell.x > EPS ? gap / 2 : 0);
		const x1 = pad + (cell.x + cell.w) * innerW - (cell.x + cell.w < .999999 ? gap / 2 : 0);
		const y0 = pad + cell.y * innerH + (cell.y > EPS ? gap / 2 : 0);
		const y1 = pad + (cell.y + cell.h) * innerH - (cell.y + cell.h < .999999 ? gap / 2 : 0);
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
	const pad = Math.max(0, layout.padding);
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
		const cross = pad + lane * (laneSize + gap);
		const pos = pad + laneOffsets[lane];
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
	const crossTotal = pad * 2 + lanes * laneSize + (lanes - 1) * gap;
	const alongTotal = Math.max(1, Math.max(...laneOffsets) - (cells.length ? gap : 0)) + pad * 2;
	return {
		width: Math.min(MAX_SIDE, vertical ? crossTotal : alongTotal),
		height: Math.min(MAX_SIDE, vertical ? alongTotal : crossTotal),
		cells
	};
}
/** 按顺序把图片分成 n 行，使每行宽高比之和尽量平均 */
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
	const pad = Math.max(0, layout.padding);
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
		innerMain = Math.max(1, fixedMain - pad * 2);
		rowHeights = rows.map((_, r) => Math.max(1, (innerMain - rowGaps[r]) / rowAspect[r]));
		if (fixedCross) {
			const k = Math.max(rows.length, fixedCross - pad * 2 - crossGaps) / rowHeights.reduce((a, b) => a + b, 0);
			rowHeights = rowHeights.map((h) => h * k);
		}
	} else {
		let lineH;
		if (fixedCross) lineH = Math.max(1, (fixedCross - pad * 2 - crossGaps) / rows.length);
		else {
			const hs = items.map((x) => x.h);
			lineH = layout.autoBase === "max" ? Math.max(...hs) : layout.autoBase === "median" ? median(hs) : Math.min(...hs);
		}
		rowHeights = rows.map(() => lineH);
		innerMain = Math.max(...rows.map((_, r) => lineH * rowAspect[r] + rowGaps[r]));
	}
	const cells = [];
	let crossPos = pad;
	rows.forEach((row, r) => {
		const rh = Math.round(rowHeights[r]);
		const avail = innerMain - rowGaps[r];
		let mainPos = pad;
		row.forEach((idx, j) => {
			const end = j === row.length - 1 ? pad + innerMain : mainPos + avail * aspects[idx] / rowAspect[r];
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
	const main = Math.min(MAX_SIDE, Math.round(innerMain + pad * 2));
	const cross = Math.min(MAX_SIDE, fixedCross && fixedMain ? fixedCross : crossPos - gap + pad);
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
	copy.name = name ?? `${layout.name} 副本`;
	if (copy.kind === "grid") copy.cells = copy.cells.map((c) => ({
		...c,
		id: uid()
	}));
	return copy;
}
//#endregion
//#region src/lib/bridge.ts
/** 运行环境诊断：返回 null 表示一切正常，否则返回原因 */
function envProblem() {
	if (!window.utools) return "未检测到 uTools 环境（window.utools 不存在），请在 uTools 中打开插件";
	if (!window.services) return window.__quickUnionPreload === "loading" ? "preload.js 执行出错，请按 Ctrl/⌘+Shift+I 打开开发者工具查看控制台错误" : "preload.js 未加载：请确认导入的是构建目录 dist/plugin.json，且 dist 中有 preload.js";
	return null;
}
function services() {
	const problem = envProblem();
	if (problem) throw new Error(problem);
	return window.services;
}
function utools() {
	if (!window.utools) throw new Error("当前不在 uTools 环境中");
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
/** sharp 与 nativeImage 都无法解码时，用 Chromium 解码再转 PNG */
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
		if (!blob) throw new Error("浏览器解码失败");
		return {
			...await svc.importBytes(new Uint8Array(await blob.arrayBuffer()), name, thumbSize),
			srcPath
		};
	} finally {
		URL.revokeObjectURL(url);
	}
}
/** 导入文件或文件夹：所有图片都规范化为 PNG 工作副本 */
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
//#endregion
//#region src/lib/storage.ts
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
	if (res.error) throw new Error(res.message || "保存失败");
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
			} catch {}
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
//#endregion
//#region src/lib/stitch.ts
/** 把布局解析为 preload 可执行的拼接任务（images 按 slot 排列，可含空位） */
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
//#endregion
//#region src/lib/workflow.ts
var STEP_LABEL = {
	edit: "编辑",
	stitch: "拼接",
	export: "导出"
};
function newStep(type, defaultPresetId) {
	if (type === "edit") return {
		id: uid(),
		type,
		op: {
			type: "resize",
			mode: "scale",
			scale: .5
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
		case "rotate": return `旋转 ${op.angle}°`;
		case "flip": return [op.horizontal && "水平", op.vertical && "垂直"].filter(Boolean).join("+") + "翻转";
		case "crop": return `裁切 ${Math.round(op.w * 100)}%×${Math.round(op.h * 100)}%`;
		case "cropRatio": return `按 ${op.ratioW}:${op.ratioH} 裁切`;
		case "trim": return "去除纯色边";
		case "resize":
			if (op.mode === "scale") return `缩放 ${Math.round(op.scale * 100)}%`;
			if (op.mode === "width") return `宽度 ${op.width}px`;
			if (op.mode === "height") return `高度 ${op.height}px`;
			if (op.mode === "maxSide") return `最长边 ${op.size}px`;
			return `尺寸 ${op.width}×${op.height}`;
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
		onProgress("导入图片…");
		const res = await importPaths(input.paths, {
			recursive: wf.recursive,
			thumbSize: TRAY_THUMB,
			onProgress: (d, t) => onProgress(`导入图片 ${d}/${t}`)
		});
		failed.push(...res.failed);
		list.push(...res.images.map((r) => ({
			...r,
			srcDir: r.srcPath ? svc.dirname(r.srcPath) : ""
		})));
	}
	if (input.dataUrl) {
		const r = await svc.importDataUrl(input.dataUrl, "粘贴的图片", TRAY_THUMB);
		list.push({
			...r,
			srcDir: ""
		});
	}
	for (const r of input.images ?? []) list.push({
		...r,
		srcDir: r.srcPath ? svc.dirname(r.srcPath) : ""
	});
	if (!list.length) throw new Error("没有可处理的图片");
	const exported = [];
	const steps = wf.steps;
	for (let s = 0; s < steps.length; s++) {
		const step = steps[s];
		const tag = `步骤 ${s + 1}/${steps.length} ${STEP_LABEL[step.type]}`;
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
			if (!layout) throw new Error(`${tag}：找不到网格预设，可能已被删除`);
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
				const name = groups.length > 1 ? `${group[0].name}-拼图${g + 1}` : `${group[0].name}-拼图`;
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
	const u = utools();
	let dir;
	if (step.target === "custom" && step.customDir) dir = step.customDir;
	else if (step.target === "source" && item.srcDir) dir = item.srcDir;
	else if (step.target === "ask" && askedDir) dir = askedDir;
	else dir = u.getPath("downloads");
	return step.subDir ? services().join(dir, step.subDir) : dir;
}
async function runExport(step, list, progress) {
	const svc = services();
	const u = utools();
	askedDir = null;
	if (step.target === "ask") {
		const picked = u.showOpenDialog({
			title: "选择导出目录",
			properties: ["openDirectory", "createDirectory"]
		});
		if (!picked?.length) throw new Error("已取消导出");
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
//#endregion
//#region src/mcp/index.ts
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
	if (!Array.isArray(ops) || !ops.length) throw new Error("ops 不能为空");
	return ops.map((raw, i) => {
		const op = { ...raw };
		const key = op.type === "resize" ? `resize:${op.mode}` : String(op.type);
		const fields = OP_FIELDS[key];
		if (!fields) throw new Error(`ops[${i}]：不支持的操作 ${key}`);
		const missing = fields.filter((f) => op[f] === void 0);
		if (missing.length) throw new Error(`ops[${i}]（${key}）缺少字段：${missing.join(", ")}`);
		if (op.type === "flip") {
			op.horizontal = !!op.horizontal;
			op.vertical = !!op.vertical;
		}
		if (op.type === "cropRatio") op.position ??= "center";
		if (op.type === "trim") op.threshold ??= 10;
		if (key === "resize:box") {
			op.fit ??= "cover";
			op.position ??= "center";
		}
		return op;
	});
}
function allLayouts() {
	return [...BUILTIN_LAYOUTS, ...layoutStore.list()];
}
function requirePaths(params) {
	const all = Array.isArray(params.paths) ? params.paths.filter((p) => typeof p === "string" && p) : [];
	if (!all.length) throw new Error("paths 不能为空：请传入图片文件或文件夹的绝对路径");
	const svc = services();
	const paths = all.filter((p) => svc.exists(p));
	const missing = all.filter((p) => !svc.exists(p)).map((path) => ({
		path,
		reason: "文件或文件夹不存在"
	}));
	if (!paths.length) throw new Error(`路径都不存在：${all.slice(0, 3).join("、")}${all.length > 3 ? " 等" : ""}（需要绝对路径）`);
	return {
		paths,
		missing
	};
}
/** 导出步骤：没给 output_dir 时导出到源图所在目录（剪贴板 / 生成的图片没有源目录，退回下载目录） */
function exportStep(params, defaultName) {
	const step = newStep("export", "");
	if (params.format !== void 0 && !FORMATS.includes(params.format)) throw new Error(`format 只能是 ${FORMATS.join(" / ")}`);
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
		}).catch(() => {});
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
			if (s.type === "edit") return `${STEP_LABEL.edit}：${describeOp(s.op)}`;
			if (s.type === "stitch") return `${STEP_LABEL.stitch}：${layouts.find((l) => l.id === s.presetId)?.name ?? "预设已删除"}`;
			return `${STEP_LABEL.export}：${s.format}`;
		})
	};
}
/** 在预设基础上覆盖间距、边距等参数，不修改已保存的预设 */
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
		})), exportStep(params, "{name}-编辑")], paths, !!params.recursive, allLayouts(), ctx);
	});
	api.registerTool("stitch_images", async (params, ctx) => {
		const paths = requirePaths(params);
		const layouts = allLayouts();
		const presetId = params.preset_id || DEFAULT_LAYOUT;
		const preset = layouts.find((l) => l.id === presetId || l.name === presetId);
		if (!preset) throw new Error(`找不到网格预设「${presetId}」，可以先调用 list_presets 查看`);
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
		if (!wf) throw new Error(`找不到工作流「${key}」，可以先调用 list_presets 查看`);
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
		if (!steps.some((s) => s.type === "export")) throw new Error("这个工作流没有导出步骤，不会产生文件");
		return run(steps, paths, params.recursive ?? wf.recursive, allLayouts(), ctx);
	});
}
//#endregion
exports.registerMcpTools = registerMcpTools;
