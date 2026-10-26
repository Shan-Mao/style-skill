/** 跨图片汇总的确定性计算：颜色跨图匹配与空间网格统计。 */

import type { ImportedImage } from './imageImport'

/** 跨图颜色匹配的 RGB 欧氏距离阈值 */
export const CROSS_COLOR_DISTANCE = 40

export type ColorGroupEntry = { fileName: string; ratio: number }

export type ColorGroup = {
  /** 组内平均色（展示用） */
  hex: string
  imageCount: number
  entries: ColorGroupEntry[]
  minRatio: number
  maxRatio: number
  avgRatio: number
}

export type SpatialCross = {
  /** 每格跨图平均边缘密度（无有效数据的格为 NaN） */
  avgEdgeDensity: number[]
  /** 每格跨图边缘密度标准差 */
  stdEdgeDensity: number[]
  /** 每格在各图中的最小/最大边缘密度 */
  minEdgeDensity: number[]
  maxEdgeDensity: number[]
  /** 每格有有效数据的图片数 */
  validCounts: number[]
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

function rgbToHex(r: number, g: number, b: number): string {
  const part = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase()
}

function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2)
}

/** 把各图的主要颜色按相近程度归组：同组视为同一颜色在不同图中的出现。 */
export function matchColorGroups(images: ImportedImage[]): ColorGroup[] {
  type Item = { hex: string; fileName: string; ratio: number }
  const items: Item[] = []
  for (const img of images) {
    for (const c of img.features.colors) {
      items.push({ hex: c.hex, fileName: img.fileName, ratio: c.ratio })
    }
  }

  // 按占比降序贪心聚类：占比最高的颜色作为组种子，相近颜色并入
  const groups: Item[][] = []
  for (const item of [...items].sort((a, b) => b.ratio - a.ratio)) {
    let merged = false
    for (const g of groups) {
      if (colorDistance(item.hex, g[0].hex) > CROSS_COLOR_DISTANCE) continue
      const existing = g.find((e) => e.fileName === item.fileName)
      if (existing) {
        // 同一张图落入同组时只保留占比更高的一个，避免重复计数
        if (item.ratio > existing.ratio) {
          existing.hex = item.hex
          existing.ratio = item.ratio
        }
      } else {
        g.push(item)
      }
      merged = true
      break
    }
    if (!merged) groups.push([item])
  }

  return groups
    .map((g) => {
      const entries = g.map((e) => ({ fileName: e.fileName, ratio: e.ratio }))
      const ratios = entries.map((e) => e.ratio)
      let rs = 0
      let gs = 0
      let bs = 0
      for (const e of g) {
        const [r, gg, b] = hexToRgb(e.hex)
        rs += r
        gs += gg
        bs += b
      }
      return {
        hex: rgbToHex(rs / g.length, gs / g.length, bs / g.length),
        imageCount: entries.length,
        entries,
        minRatio: Math.min(...ratios),
        maxRatio: Math.max(...ratios),
        avgRatio: ratios.reduce((a, b) => a + b, 0) / ratios.length,
      }
    })
    .sort((a, b) => b.imageCount - a.imageCount || b.avgRatio - a.avgRatio)
}

/** 跨图统计 4×4 网格：每格的平均/标准差/最小/最大边缘密度。 */
export function spatialCrossStats(images: ImportedImage[]): SpatialCross {
  const cells = 16
  const avgEdgeDensity = new Array<number>(cells).fill(Number.NaN)
  const stdEdgeDensity = new Array<number>(cells).fill(Number.NaN)
  const minEdgeDensity = new Array<number>(cells).fill(Number.NaN)
  const maxEdgeDensity = new Array<number>(cells).fill(Number.NaN)
  const validCounts = new Array<number>(cells).fill(0)

  for (let cell = 0; cell < cells; cell++) {
    const values = images
      .map((img) => img.features.grid.edgeDensity[cell])
      .filter((v) => Number.isFinite(v))
    if (values.length === 0) continue
    validCounts[cell] = values.length
    const avg = values.reduce((a, b) => a + b, 0) / values.length
    avgEdgeDensity[cell] = avg
    minEdgeDensity[cell] = Math.min(...values)
    maxEdgeDensity[cell] = Math.max(...values)
    stdEdgeDensity[cell] =
      values.length > 1
        ? Math.sqrt(values.reduce((acc, v) => acc + (v - avg) ** 2, 0) / values.length)
        : 0
  }
  return { avgEdgeDensity, stdEdgeDensity, minEdgeDensity, maxEdgeDensity, validCounts }
}
