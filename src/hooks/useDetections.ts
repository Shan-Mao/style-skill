import { useCallback, useState } from 'react'
import { detectElements } from '../lib/detectionClient'
import type { DetectionState, DetectionStateMap } from '../lib/detectionClient'
import type { ImportedImage } from '../lib/imageImport'

export type { DetectionState, DetectionStateMap }

/**
 * 每张图片的 ScreenParser 检测结果缓存（按 imageId 存放）。
 * 与 Canvas 统计特征（ImportedImage.features）分开保存、互不覆盖。
 *
 * 字节来源：直接使用导入时保留的原始 File 引用（磁盘后备数据，稳定可重复读取）。
 * 不通过 fetch(previewUrl) 取回——blob: URL 在 Tauri 发布模式会被
 * CSP connect-src 拦截（详见 tauri.conf.json 与本次修复记录）。
 *
 * 失败策略：检测失败或服务不可用时保留最近一次成功的 result
 * （stale=true），并用 status/message 单独记录当前错误，界面据此
 * 明确区分最新结果与历史结果；检测失败只影响本面板，不影响导入、
 * 规则与 Skill 导出。
 */
export function useDetections() {
  const [detections, setDetections] = useState<DetectionStateMap>({})

  const runDetection = useCallback(async (image: ImportedImage) => {
    // 进入 running 时保留旧 result（标记为旧），失败后可继续展示
    setDetections((prev) => {
      const old = prev[image.id]?.result
      return {
        ...prev,
        [image.id]: old
          ? { status: 'running', result: old, stale: true }
          : { status: 'running' },
      }
    })

    const finishFailure = (status: 'unavailable' | 'error', message: string) => {
      setDetections((prev) => {
        const old = prev[image.id]?.result
        return {
          ...prev,
          [image.id]: old
            ? { status, message, result: old, stale: true }
            : { status, message },
        }
      })
    }

    // 防御：理论上导入流程保证 file 存在；缺失说明内部状态异常
    if (!image.file) {
      finishFailure('error', '该图片缺少原始文件引用，请重新导入后再检测')
      return
    }
    const result = await detectElements(image.file)
    if (result.ok) {
      setDetections((prev) => ({
        ...prev,
        [image.id]: { status: 'done', result, stale: false },
      }))
    } else {
      finishFailure(
        result.code === 'server_unreachable' ? 'unavailable' : 'error',
        result.message,
      )
    }
  }, [])

  return { detections, runDetection }
}
