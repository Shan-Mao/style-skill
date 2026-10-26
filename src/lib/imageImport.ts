import { computeFeatures } from './imageFeatures'
import type { ImageFeatures } from './imageFeatures'

/** 单张图片大小上限（字节） */
export const MAX_FILE_SIZE = 10 * 1024 * 1024

const SUPPORTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const SUPPORTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']

export type ImportedImage = {
  id: string
  fileName: string
  fileSize: number
  /** 解码后的原始宽高（像素） */
  width: number
  height: number
  /** 原文件的 objectURL，仅用于本地预览（<img>；检测请求不依赖它） */
  previewUrl: string
  /** 原始 File 引用：File 是磁盘后备数据，检测请求直接使用它构建字节，
   *  不经过 objectURL（blob: fetch 在 Tauri 发布模式会被 CSP connect-src 拦截） */
  file: File
  features: ImageFeatures
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 文件名去扩展名后截短，用于表格与来源标注 */
export function shortFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '')
  return base.length > 12 ? `${base.slice(0, 12)}…` : base
}

function hasSupportedType(file: File): boolean {
  if (file.type) return SUPPORTED_MIME_TYPES.includes(file.type)
  const lower = file.name.toLowerCase()
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

async function decodeImage(file: File): Promise<ImageBitmap> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(`「${file.name}」解码失败，文件可能已损坏或不是有效的图片`)
  }
  if (bitmap.width < 1 || bitmap.height < 1) {
    bitmap.close()
    throw new Error(`「${file.name}」解码后的尺寸无效，文件可能已损坏`)
  }
  return bitmap
}

/** 校验并导入单个文件：类型 / 大小 / 可解码性检查，全部在本地完成 */
export async function importImageFile(file: File): Promise<ImportedImage> {
  if (!hasSupportedType(file)) {
    throw new Error(`「${file.name}」格式不受支持：仅支持 PNG、JPEG、WebP`)
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `「${file.name}」超过大小限制：当前 ${formatBytes(file.size)}，上限 ${formatBytes(MAX_FILE_SIZE)}`,
    )
  }

  const bitmap = await decodeImage(file)
  try {
    return {
      id: crypto.randomUUID(),
      fileName: file.name || '未命名图片',
      fileSize: file.size,
      width: bitmap.width,
      height: bitmap.height,
      previewUrl: URL.createObjectURL(file),
      file,
      features: computeFeatures(bitmap),
    }
  } finally {
    bitmap.close()
  }
}
