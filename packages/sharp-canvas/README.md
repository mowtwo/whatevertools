# @whatevertools/sharp-canvas

Browser implementation of a practical subset of the sharp image API on top of HTML Canvas

在浏览器里用 Canvas 实现 [sharp](https://sharp.pixelplumbing.com/) 的常用子集，Web 运行时把它注入成 `utools.sharp` / `image.sharp`，让用了 sharp 的 uTools 插件在浏览器里照常工作。

这是 [whatevertools](https://github.com/mowtwo/whatevertools) 的一部分，用法和架构见仓库 README。

## 用法

```ts
import { createCanvasSharp } from '@whatevertools/sharp-canvas'

const sharp = createCanvasSharp({
  readFile: (p) => fs.readFileSync(p),        // 路径输入
  writeFile: (p, d) => fs.writeFileSync(p, d), // toFile
  Buffer,                                      // 有 Buffer shim 时输出用 Buffer.from 包装
})
const png = await sharp(input).resize(256, 256, { fit: 'contain', background: 'transparent' }).png().toBuffer()
```

有 `document` 时用 `<canvas>`，否则用 `OffscreenCanvas`（Worker 里也能跑，但 SVG 输入需要 `document`）。

## 支持的内容

- 输入：文件路径（`io.readFile`）、Buffer / Uint8Array / ArrayBuffer（按魔数识别 png / jpeg / webp / gif / bmp / avif / svg / ico，能否解码取决于浏览器）、`{ create: { width, height, channels: 3|4, background } }`、`{ raw: { width, height, channels: 1~4 } }` 原始像素。`density` 对 SVG 生效；`failOn`、`limitInputPixels`、`animated` 等选项接受但忽略。
- 信息：`metadata()`（含 jpeg 的 EXIF `orientation`、`autoOrient`、PNG/JPEG 的 DPI）、`stats()`。
- 几何：`resize`（cover / contain / fill / inside / outside、position / gravity / strategy、`kernel: 'nearest'`、withoutEnlargement / withoutReduction）、`extend`、`extract`、`trim`（info 里带 trimOffsetLeft / trimOffsetTop）、`rotate`（90 的倍数无损；任意角度扩成外接矩形）、`autoOrient`、`flip`、`flop`。
- 通道：`flatten`、`ensureAlpha`、`removeAlpha`、`extractChannel`、`toColourspace('b-w')`。
- 合成：`composite`（输入同上，top/left 或 gravity、`tile`、各种 blend；in / dest-in 等模式覆盖层以外按透明处理，与 libvips 一致）。
- 像素：`blur`、`sharpen`、`median`、`grayscale` / `greyscale`、`negate`、`modulate`、`tint`、`gamma`、`normalise` / `normalize`、`threshold`、`linear`。
- 输出：`png`、`jpeg` / `jpg`、`webp`、`avif`、`heif`、`gif`、`tiff`、`raw`、`toFormat`；`toBuffer()`（支持 `resolveWithObject` 和 node 风格回调）、`toFile()`（按扩展名选格式，经 `io.writeFile` 写出）。默认输出格式跟随输入（raw / create 输入默认 raw，不能编码的格式退回 png）。
- 其他：`clone`；`withMetadata` / `keepMetadata` / `withIccProfile` / `timeout` 等为空操作；静态 `cache()`、`concurrency()`、`simd()`、`counters()`、`versions`、`format`、`gravity`、`strategy`、`position`、`fit`、`kernel`。

## 与 sharp 的差异

- 操作严格按调用顺序执行（sharp 内部有固定顺序，比如 extract 写在 resize 前后含义不同、rotate 总在最前）。`rotate()` / `autoOrient()` 不论写在哪都在解码时生效。
- 没有 ICC / 色彩管理：全部按 sRGB 8 位处理，嵌入的 ICC、EXIF、XMP 都不会写入输出；16 位、CMYK、多页 / 动图（只取第一帧）不支持。
- 缩放用浏览器的插值（`imageSmoothingQuality: 'high'` + 大比例逐级减半），只有 `nearest` 和默认两档，与 lanczos3 结果有细微差别；JPEG / WebP 的压缩质量、文件体积和 libvips 不同，PNG 的 compressionLevel / palette 等选项忽略。
- Canvas 内部是预乘 alpha，完全透明像素的颜色会丢失，半透明像素有 ±1 的舍入误差。
- 能编码哪些格式取决于浏览器：png / jpeg / webp 普遍可用；AVIF、GIF、TIFF、HEIF 编码多数浏览器不支持，显式要求时抛 `code: 'EWTUNSUPPORTED'` 的错误。
- 输入 EXIF 方向只解析 jpeg；其他格式的 EXIF 方向交给浏览器。
- `stats().sharpness` 恒为 0；`normalise` 按每个颜色通道的百分位拉伸（sharp 按亮度）；`withoutEnlargement` / `withoutReduction` 触发时整个 resize 跳过。
- 不支持：`text` 输入、多图 `join`、流式接口（pipe / stream）、`affine`、`convolve`、`recomb`、`boolean`、`joinChannel`、`bandbool`、`clahe`、`dilate`、`erode`、`unflatten`（这些方法调用时抛 `EWTUNSUPPORTED`）。

## 测试

`pnpm test:sharp`：用 esbuild 打包，在无界面 Chrome 里跑真实断言。

MIT
