// 定时任务的 API 实现：引擎在 core（Scheduler），这里只做参数转发
import type { Handler } from '../types'

export const scheduleSvc: Record<string, Handler> = {
  'schedule.request': (c, s) => {
    // 旧平台约定：请求流程结束即 resolve，不代表创建成功；参数无效时只记日志
    try {
      c.host.scheduler.add(c.plugin.id, s)
    } catch (e) {
      c.host.log('warn', `${c.plugin.id} 的定时任务没有创建：${(e as Error).message}`)
    }
  },
  'schedule.list': (c) => c.host.scheduler.list(c.plugin.id),
  'schedule.remove': (c, code: string) => c.host.scheduler.remove(c.plugin.id, code),
}
