import { socket } from './socket'

export type NginxTarget = { id: string; label: string; proxyPass: string; referer: string }

export type NginxRoute = {
  id: string
  path: string
  note: string
  enabled: boolean
  kind: 'proxy' | 'raw'
  activeTargetId: string
  targets: NginxTarget[]
  headers: { httpVersion: boolean; host: boolean; upgrade: boolean; connection: boolean }
  others: Array<{ name: string; value: string }>
  rawBody: string
}

export type NginxStatus = {
  installed: boolean
  running: boolean
  pid: number
  port: number
  prefixDir: string
  confPath: string
  routesDir: string
  logDir: string
}

export type NginxConflict = { id: string; path: string }
export type NginxUntracked = { name: string; path: string }

export type NginxOverview = {
  state: Record<string, unknown>
  status: NginxStatus
  routes: NginxRoute[]
  conflicts: NginxConflict[]
  untracked: NginxUntracked[]
}

export type NginxActionResult = { ok: boolean; code: string; error: string }
export type NginxValidateResult = { ok: boolean; code: string; error: string; stdout: string; stderr: string }
export type NginxImportResult = { added: number; updated: number; total: number }

// 无 payload 的事件（overview/validate/reload/start/stop/restart）必须只传回调，
// 否则后端把 payload 当成 callback
export const nginxCall = <T>(event: string, payload?: unknown): Promise<T> =>
  new Promise((resolve, reject) => {
    const done = (response: any) => {
      if (response?.success === false) reject(new Error(response.error?.message || response.error || '操作失败'))
      else resolve(response?.data as T)
    }
    if (payload === undefined) socket.emit(event, done)
    else socket.emit(event, payload, done)
  })
