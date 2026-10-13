import type { Handler } from '../types'
import { aiSvc } from './ai'
import { captureSvc } from './capture'
import { clipboardSvc } from './clipboard'
import { contextSvc } from './context'
import { dataSvc } from './data'
import { inputSvc } from './input'
import { scheduleSvc } from './schedule'
import { screenSvc } from './screen'
import { system } from './system'
import { ubrowserSvc } from './ubrowser'
import { windowsSvc } from './windows'

/** API 方法名 → main 侧实现。宿主可以替换任意一项（host.handlers[name] = ...），或用 service:<name> hook 包装 */
export const services: Record<string, Handler> = {
  ...system,
  ...screenSvc,
  ...clipboardSvc,
  ...contextSvc,
  ...inputSvc,
  ...windowsSvc,
  ...dataSvc,
  ...scheduleSvc,
  ...captureSvc,
  ...aiSvc,
  ...ubrowserSvc,
}
