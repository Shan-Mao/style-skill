/**
 * 确定性图像特征计算。
 * 所有指标都在缩放后的采样上用 Canvas 像素数据直接计算，不涉及任何 AI 推测。
 */

export type ColorSwatch = {
  hex: string
  /** 占不透明像素的比例（0–1） */
  ratio: number
}

export type SpatialStats = {
  /** 每格平均亮度（0–255），4×4 行优先；该格无采样像素时为 NaN */
  luminance: number[]
  /** 每格边缘像素占比（0–1）；该格无内部像素时为 NaN */
  edgeDensity: number[]
}

export type ImageFeatures = {
  sampleWidth: number
  sampleHeight: number
  /** 不透明像素占采样总数的比例（0–1） */
  opaqueRatio: number
  /** 主要颜色，按占比降序，最多 6 组 */
  colors: ColorSwatch[]
  /** 未进入主要颜色的剩余占比（0–1） */
  colorRemainder: number
  /** 平均亮度（0–255，仅不透明像素） */
  meanLuminance: number
  /** 亮度标准差（0–255，越大代表明暗对比越强，仅不透明像素） */
  luminanceStd: number
  /** 亮度直方图，16 桶计数（仅不透明像素） */
  luminanceHistogram: number[]
  /** 边缘像素占内部像素的比例（0–1） */
  edgeDensity: number
  /** Sobel 幅值阈值（经验值） */
  edgeThreshold: number
  /** 边缘走向分布：6 个 30° 区间，按梯度幅值加权的占比（0–1）；0° 附近为水平边缘 */
  orientation: number[]
  grid: SpatialStats
}

/** 分析采样的最长边上限（像素） */
const MAX_SAMPLE_DIM = 512
/** 颜色量化：每通道 bit 数 */
const COLOR_BITS = 4
/** 合并到同一颜色聚类的最大 RGB 欧氏距离 */
const CLUSTER_MERGE_DISTANCE = 60
const TOP_COLOR_COUNT = 6
/** Sobel 边缘判定阈值（梯度幅值） */
const SOBEL_THRESHOLD = 48
const GRID_SIZE = 4

function drawSample(bitmap: ImageBitmap): ImageData {
  const scale = Math.min(1, MAX_SAMPLE_DIM / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error('无法创建画布上下文')
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

function toHex(r: number, g: number, b: number): string {
  const part = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase()
}

type ColorBin = { r: number; g: number; b: number; count: number }

function clusterColors(bins: ColorBin[], total: number): { colors: ColorSwatch[]; remainder: number } {
  const sorted = [...bins].sort((a, b) => b.count - a.count)
  const mergeDistance2 = CLUSTER_MERGE_DISTANCE * CLUSTER_MERGE_DISTANCE
  const colors: ColorSwatch[] = []

  for (const seed of sorted) {
    if (colors.length >= TOP_COLOR_COUNT) break
    if (seed.count < 0) continue
    let sumR = 0
    let sumG = 0
    let sumB = 0
    let sumCount = 0
    for (const bin of sorted) {
      if (bin.count < 0) continue
      const dr = bin.r - seed.r
      const dg = bin.g - seed.g
      const db = bin.b - seed.b
      if (dr * dr + dg * dg + db * db <= mergeDistance2) {
        sumR += bin.r * bin.count
        sumG += bin.g * bin.count
        sumB += bin.b * bin.count
        sumCount += bin.count
        bin.count = -1
      }
    }
    colors.push({
      hex: toHex(sumR / sumCount, sumG / sumCount, sumB / sumCount),
      ratio: sumCount / total,
    })
  }

  const remainder = Math.max(0, 1 - colors.reduce((acc, c) => acc + c.ratio, 0))
  return { colors, remainder }
}

/** 采样坐标 → 4×4 网格下标（行优先） */
function cellIndexOf(x: number, y: number, w: number, h: number): number {
  const col = Math.min(GRID_SIZE - 1, ((x / w) * GRID_SIZE) | 0)
  const row = Math.min(GRID_SIZE - 1, ((y / h) * GRID_SIZE) | 0)
  return row * GRID_SIZE + col
}

export function computeFeatures(bitmap: ImageBitmap): ImageFeatures {
  const { width: w, height: h, data } = drawSample(bitmap)
  const pixelCount = w * h
  const cellCount = GRID_SIZE * GRID_SIZE

  const gray = new Uint8Array(pixelCount)
  const histogram = new Array<number>(16).fill(0)
  const bins = new Map<number, number>()
  const cellLumaSum = new Array<number>(cellCount).fill(0)
  const cellPixels = new Array<number>(cellCount).fill(0)
  let opaque = 0
  let lumaSum = 0
  let lumaSqSum = 0

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const r = data[i * 4]
      const g = data[i * 4 + 1]
      const b = data[i * 4 + 2]
      const luma = (2126 * r + 7152 * g + 722 * b) / 10000
      gray[i] = luma
      if (data[i * 4 + 3] < 128) continue
      opaque++
      lumaSum += luma
      lumaSqSum += luma * luma
      histogram[Math.min(15, (luma / 16) | 0)]++
      const key = ((r >> COLOR_BITS) << 8) | ((g >> COLOR_BITS) << 4) | (b >> COLOR_BITS)
      bins.set(key, (bins.get(key) ?? 0) + 1)
      const cell = cellIndexOf(x, y, w, h)
      cellLumaSum[cell] += luma
      cellPixels[cell]++
    }
  }

  const binList: ColorBin[] = [...bins.entries()].map(([key, count]) => ({
    r: ((key >> 8) & 15) * 16 + 8,
    g: ((key >> 4) & 15) * 16 + 8,
    b: (key & 15) * 16 + 8,
    count,
  }))
  const { colors, remainder } =
    opaque > 0 ? clusterColors(binList, opaque) : { colors: [], remainder: 0 }

  // Sobel 边缘检测：统计边缘比例、按幅值加权的走向分布、每格边缘密度
  const threshold2 = SOBEL_THRESHOLD * SOBEL_THRESHOLD
  const orientationWeights = new Array<number>(6).fill(0)
  const cellEdgePixels = new Array<number>(cellCount).fill(0)
  const cellInteriorPixels = new Array<number>(cellCount).fill(0)
  let edgeCount = 0
  let orientationTotal = 0

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const tl = gray[i - w - 1]
      const tc = gray[i - w]
      const tr = gray[i - w + 1]
      const ml = gray[i - 1]
      const mr = gray[i + 1]
      const bl = gray[i + w - 1]
      const bc = gray[i + w]
      const br = gray[i + w + 1]
      const gx = tr + 2 * mr + br - tl - 2 * ml - bl
      const gy = bl + 2 * bc + br - tl - 2 * tc - tr
      const mag2 = gx * gx + gy * gy
      const cell = cellIndexOf(x, y, w, h)
      cellInteriorPixels[cell]++
      if (mag2 <= threshold2) continue
      edgeCount++
      cellEdgePixels[cell]++
      const mag = Math.sqrt(mag2)
      // 边缘走向 = 梯度方向 + 90°，归一到 [0, 180)：0° 为水平边缘，90° 为垂直边缘
      const angleDeg = (Math.atan2(gy, gx) * 180) / Math.PI
      const edgeAngle = (angleDeg + 90 + 360) % 180
      orientationWeights[Math.min(5, (edgeAngle / 30) | 0)] += mag
      orientationTotal += mag
    }
  }

  const interiorPixels = (w - 2) * (h - 2)

  return {
    sampleWidth: w,
    sampleHeight: h,
    opaqueRatio: pixelCount > 0 ? opaque / pixelCount : 0,
    colors,
    colorRemainder: remainder,
    meanLuminance: opaque > 0 ? lumaSum / opaque : 0,
    luminanceStd:
      opaque > 0
        ? Math.sqrt(Math.max(0, lumaSqSum / opaque - (lumaSum / opaque) ** 2))
        : 0,
    luminanceHistogram: histogram,
    edgeDensity: interiorPixels > 0 ? edgeCount / interiorPixels : 0,
    edgeThreshold: SOBEL_THRESHOLD,
    orientation:
      orientationTotal > 0
        ? orientationWeights.map((v) => v / orientationTotal)
        : new Array<number>(6).fill(0),
    grid: {
      luminance: cellLumaSum.map((sum, idx) =>
        cellPixels[idx] > 0 ? sum / cellPixels[idx] : Number.NaN,
      ),
      edgeDensity: cellEdgePixels.map((edges, idx) =>
        cellInteriorPixels[idx] > 0 ? edges / cellInteriorPixels[idx] : Number.NaN,
      ),
    },
  }
}
