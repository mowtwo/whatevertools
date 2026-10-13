import { desktopCapturer, screen } from 'electron'
import type { Handler } from '../types'
import { serialize } from './util'

const mac = process.platform === 'darwin'

function displayInfo(d: Electron.Display) {
  return { id: d.id, bounds: d.bounds, workArea: d.workArea, workAreaSize: d.workAreaSize, size: d.size, scaleFactor: d.scaleFactor, rotation: d.rotation, label: d.label, internal: d.internal }
}

/** 截取显示器（物理像素） */
export async function captureDisplays(displayId?: number) {
  const displays = screen.getAllDisplays().filter((d) => displayId === undefined || d.id === displayId)
  if (!displays.length) throw new Error(`找不到显示器：${displayId}`)
  const maxW = Math.max(...displays.map((d) => Math.round(d.size.width * d.scaleFactor)))
  const maxH = Math.max(...displays.map((d) => Math.round(d.size.height * d.scaleFactor)))
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: maxW, height: maxH } })
  return displays.map((d, i) => {
    const src = sources.find((s) => s.display_id === String(d.id)) ?? sources[i]
    if (!src) throw new Error('无法截取屏幕（检查系统的屏幕录制权限）')
    let image = src.thumbnail
    const want = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) }
    const got = image.getSize()
    if (got.width !== want.width || got.height !== want.height) image = image.resize(want)
    return { display: displayInfo(d), image }
  })
}

export const screenSvc: Record<string, Handler> = {
  'screen.displays': () => screen.getAllDisplays().map(displayInfo),
  'screen.primaryDisplay': () => displayInfo(screen.getPrimaryDisplay()),
  'screen.cursor': () => screen.getCursorScreenPoint(),
  'screen.nearestDisplay': (_c, p: Electron.Point) => displayInfo(screen.getDisplayNearestPoint(p)),
  'screen.matchingDisplay': (_c, r: Electron.Rectangle) => displayInfo(screen.getDisplayMatching(r)),
  // macOS 上 DIP 与屏幕坐标一致；Windows/Linux 用 Electron 的换算
  'screen.toDipPoint': (_c, p: Electron.Point) => (mac ? p : screen.screenToDipPoint(p)),
  'screen.toScreenPoint': (_c, p: Electron.Point) => (mac ? p : screen.dipToScreenPoint(p)),
  'screen.toDipRect': (_c, r: Electron.Rectangle) => (mac ? r : screen.screenToDipRect(null, r)),
  'screen.toScreenRect': (_c, r: Electron.Rectangle) => (mac ? r : screen.dipToScreenRect(null, r)),
  'screen.captureDisplay': async (_c, opts: { displayId?: number } = {}) => serialize(await captureDisplays(opts?.displayId)),
  'screen.captureSources': async (_c, opts: Partial<Electron.SourcesOptions> = {}) => {
    const sources = await desktopCapturer.getSources({ types: opts.types ?? ['screen', 'window'], thumbnailSize: opts.thumbnailSize, fetchWindowIcons: opts.fetchWindowIcons })
    return serialize(sources.map((s) => ({ id: s.id, type: s.id.startsWith('screen') ? 'screen' : 'window', name: s.name, display_id: s.display_id, thumbnail: s.thumbnail, appIcon: s.appIcon ?? undefined })))
  },
}
