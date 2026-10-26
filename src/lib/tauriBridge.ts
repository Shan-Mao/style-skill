/**
 * Tauri 桌面模式桥接：启动时向桌面后端查询推理服务地址（动态端口）。
 *
 * 设计约束：
 * - 不引入 @tauri-apps/api 依赖：直接使用 Tauri 注入的
 *   window.__TAURI_INTERNALS__.invoke（内部接口，仅在桌面模式存在）；
 * - Web 开发模式下本模块是空操作，默认地址 http://127.0.0.1:8765 不变；
 * - 后端返回 null（服务不可用）时同样不做事，前端走现有降级路径。
 */

import { setDetectionServerUrl } from './detectionClient'

type TauriInternals = {
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals
  }
}

/** 桌面模式下返回 true 并注入推理服务地址；Web 模式返回 false */
export async function initTauriBridge(): Promise<boolean> {
  const internals = window.__TAURI_INTERNALS__
  if (!internals?.invoke) return false
  try {
    const url = (await internals.invoke('detect_server_url')) as string | null
    if (url) {
      setDetectionServerUrl(url)
      return true
    }
  } catch {
    // 后端命令失败时保持默认地址，不阻断应用
  }
  return false
}
