/**
 * 结构识别客户端：与本地 ScreenParser 推理服务通信。
 *
 * 与现有 Canvas 统计分析（imageFeatures）完全分离：本模块只负责
 * 把图片发送给本地推理服务并解析结果，失败时返回类型化错误，
 * 永不抛出异常影响其他功能。
 *
 * 传输目标的解析（未来 Tauri 2 集成的唯一替换点）：
 * - 构建期可用 VITE_DETECTION_SERVER_URL 指定
 * - 默认 http://127.0.0.1:8765（开发模式由 `npm run detect:server` 启动）
 * - 正式发布时由桌面后端负责启动/终止推理进程，并把实际地址注入该变量；
 *   上层 UI（useDetections / DetectionPanel）不感知传输细节
 */

const DEFAULT_SERVER_URL = 'http://127.0.0.1:8765'

let serverUrl: string = import.meta.env.VITE_DETECTION_SERVER_URL ?? DEFAULT_SERVER_URL

/**
 * 运行时注入推理服务地址（Tauri 桌面模式由后端分配动态端口后调用；
 * Web 开发模式不调用，保持构建期配置或默认值）。
 */
export function setDetectionServerUrl(url: string) {
  serverUrl = url
}

export type DetectionBox = { x: number; y: number; width: number; height: number }

export type Detection = {
  label: string
  bbox: DetectionBox
  confidence: number
}

export type DetectionStats = {
  inferenceSeconds: number
  conf: number
  iou: number
  model: string
}

export type DetectionSuccess = {
  ok: true
  imageSize: { width: number; height: number }
  detections: Detection[]
  stats: DetectionStats
}

export type DetectionFailure = {
  ok: false
  code: 'server_unreachable' | 'invalid_image' | 'model_unavailable' | 'inference_failed' | 'bad_response'
  message: string
}

export type DetectionResult = DetectionSuccess | DetectionFailure

/**
 * 单张图片的检测流程状态（由 useDetections 维护）。
 * result 保存「最近一次成功」的检测结果：检测失败或服务不可用时不会丢弃，
 * 而是保留旧 result 并把 stale 置为 true，同时用 status/message 记录当前错误。
 * 界面依据 stale 区分「最新结果」与「历史结果」，不得把旧数据当作最新展示。
 */
export type DetectionState = {
  status: 'idle' | 'running' | 'unavailable' | 'error' | 'done'
  /** 当前错误信息（status 为 unavailable / error 时存在） */
  message?: string
  /** 最近一次成功的检测结果；status === 'done' 时即最新结果 */
  result?: DetectionSuccess
  /** true 表示 result 来自更早的一次成功检测，不是当前状态的产物 */
  stale?: boolean
}

export type DetectionStateMap = Record<string, DetectionState>

type ServerDetection = { label: string; bbox_xyxy: number[]; confidence: number }

type ServerResponse =
  | {
      ok: true
      image: { width: number; height: number }
      stats: { inference_seconds: number; conf: number; iou: number; model: string }
      detections: ServerDetection[]
    }
  | { ok: false; error: { code: string; message: string } }

export async function detectElements(image: Blob): Promise<DetectionResult> {
  let response: Response
  try {
    response = await fetch(`${serverUrl}/detect`, {
      method: 'POST',
      body: image,
      headers: { 'Content-Type': image.type || 'application/octet-stream' },
    })
  } catch {
    return {
      ok: false,
      code: 'server_unreachable',
      message: `无法连接本地识别服务（${serverUrl}）`,
    }
  }

  let payload: ServerResponse
  try {
    payload = (await response.json()) as ServerResponse
  } catch {
    return {
      ok: false,
      code: 'bad_response',
      message: `识别服务返回了无法解析的内容（HTTP ${response.status}）`,
    }
  }

  if (!payload.ok) {
    const code = payload.error?.code
    const knownCodes = ['invalid_image', 'model_unavailable', 'inference_failed'] as const
    return {
      ok: false,
      code: (knownCodes as readonly string[]).includes(code)
        ? (code as DetectionFailure['code'])
        : 'bad_response',
      message: payload.error?.message ?? '识别服务返回未知错误',
    }
  }

  const { width, height } = payload.image
  return {
    ok: true,
    imageSize: { width, height },
    detections: payload.detections.map((d) => ({
      label: d.label,
      confidence: d.confidence,
      bbox: {
        x: d.bbox_xyxy[0],
        y: d.bbox_xyxy[1],
        width: d.bbox_xyxy[2] - d.bbox_xyxy[0],
        height: d.bbox_xyxy[3] - d.bbox_xyxy[1],
      },
    })),
    stats: {
      inferenceSeconds: payload.stats.inference_seconds,
      conf: payload.stats.conf,
      iou: payload.stats.iou,
      model: payload.stats.model,
    },
  }
}
