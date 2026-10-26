/**
 * ScreenParser 检测结果的结构特征提取与跨图对比。
 *
 * 所有坐标与尺寸均按图片实际宽高归一化（0–1），因此不同分辨率的
 * 截图可以直接比较。对齐判定基于同类元素归一化中心点的聚类，
 * 只描述「排列成行/列」这一可观察事实，不推断 CSS gap、圆角、
 * 字体等检测框无法提供的属性。
 */

import type { DetectionSuccess } from './detectionClient'

export type SizeStats = { min: number; max: number; avg: number }

export type StructureClassStats = {
  label: string
  count: number
  avgConfidence: number
  /** 归一化尺寸（元素宽/图宽、高/图高） */
  widthNorm: SizeStats
  heightNorm: SizeStats
  /** 归一化中心点（0–1） */
  centers: { cx: number; cy: number }[]
}

export type AlignmentCluster = {
  label: string
  axis: 'row' | 'column'
  count: number
  /** 对齐轴的归一化坐标（row→cy，column→cx） */
  coordinate: number
}

export type StructureFeatures = {
  totalDetections: number
  classes: StructureClassStats[]
  alignments: AlignmentCluster[]
}

/** 同类元素中心垂直距离 ≤ 页高 2.5% 视为同一行 */
const ROW_TOLERANCE = 0.025
/** 同类元素中心水平距离 ≤ 页宽 2% 视为同一列 */
const COL_TOLERANCE = 0.02

const r3 = (v: number) => Math.round(v * 1000) / 1000

function sizeStats(values: number[]): SizeStats {
  return {
    min: r3(Math.min(...values)),
    max: r3(Math.max(...values)),
    avg: r3(values.reduce((a, b) => a + b, 0) / values.length),
  }
}

function clusterAxis(
  label: string,
  centers: { cx: number; cy: number }[],
  key: 'cx' | 'cy',
  tolerance: number,
  axis: 'row' | 'column',
): AlignmentCluster[] {
  const sorted = [...centers].sort((a, b) => a[key] - b[key])
  const clusters: AlignmentCluster[] = []
  let group: number[] = []
  let groupStart = 0
  const flush = () => {
    if (group.length >= 2) {
      clusters.push({
        label,
        axis,
        count: group.length,
        coordinate: r3(group.reduce((a, b) => a + b, 0) / group.length),
      })
    }
  }
  for (const c of sorted) {
    const v = c[key]
    if (group.length === 0) {
      group = [v]
      groupStart = v
    } else if (v - groupStart <= tolerance) {
      group.push(v)
    } else {
      flush()
      group = [v]
      groupStart = v
    }
  }
  flush()
  return clusters
}

export function extractStructureFeatures(result: DetectionSuccess): StructureFeatures {
  const { detections, imageSize } = result
  const byLabel = new Map<string, DetectionSuccess['detections']>()
  for (const d of detections) {
    const list = byLabel.get(d.label) ?? []
    list.push(d)
    byLabel.set(d.label, list)
  }

  const classes: StructureClassStats[] = [...byLabel.entries()]
    .map(([label, ds]) => ({
      label,
      count: ds.length,
      avgConfidence: r3(ds.reduce((a, d) => a + d.confidence, 0) / ds.length),
      widthNorm: sizeStats(ds.map((d) => d.bbox.width / imageSize.width)),
      heightNorm: sizeStats(ds.map((d) => d.bbox.height / imageSize.height)),
      centers: ds.map((d) => ({
        cx: (d.bbox.x + d.bbox.width / 2) / imageSize.width,
        cy: (d.bbox.y + d.bbox.height / 2) / imageSize.height,
      })),
    }))
    .sort((a, b) => b.count - a.count)

  const alignments: AlignmentCluster[] = []
  for (const c of classes) {
    alignments.push(...clusterAxis(c.label, c.centers, 'cy', ROW_TOLERANCE, 'row'))
    alignments.push(...clusterAxis(c.label, c.centers, 'cx', COL_TOLERANCE, 'column'))
  }

  return { totalDetections: detections.length, classes, alignments }
}

// ---- 跨图对比 ----

export type StructurePattern = {
  kind: 'usage' | 'size' | 'alignment'
  label: string
  /** 出现该模式的图片数 */
  imageCount: number
  totalElements: number
  /** 涉及检测的平均置信度（0–1） */
  avgConfidence: number
  /** 人类可读描述 */
  text: string
  /** usage：每图数量范围 */
  countRange?: [number, number]
  /** usage：是否仅覆盖部分图片（需要更多截图） */
  partial?: boolean
  /** alignment：轴向与每行/列最大元素数 */
  axis?: 'row' | 'column'
  maxCluster?: number
  /** size：各图平均归一化宽度范围 */
  avgWidthRange?: [number, number]
}

export type StructureComparison = {
  comparedCount: number
  perClass: {
    label: string
    perImage: { fileName: string; count: number }[]
    imageCount: number
    totalCount: number
  }[]
  sizeRanges: {
    label: string
    widthRange: [number, number]
    heightRange: [number, number]
    sampleCount: number
  }[]
  patterns: StructurePattern[]
}

export function compareStructures(
  items: { fileName: string; features: StructureFeatures }[],
): StructureComparison {
  const comparedCount = items.length

  const perClassMap = new Map<
    string,
    {
      label: string
      perImage: { fileName: string; count: number }[]
      totalCount: number
      confSum: number
      confCount: number
    }
  >()
  const sizeMap = new Map<
    string,
    { widths: { min: number; max: number }[]; heights: { min: number; max: number }[]; count: number }
  >()

  for (const item of items) {
    for (const c of item.features.classes) {
      const entry = perClassMap.get(c.label) ?? {
        label: c.label,
        perImage: [],
        totalCount: 0,
        confSum: 0,
        confCount: 0,
      }
      entry.perImage.push({ fileName: item.fileName, count: c.count })
      entry.totalCount += c.count
      entry.confSum += c.avgConfidence * c.count
      entry.confCount += c.count
      perClassMap.set(c.label, entry)

      const size = sizeMap.get(c.label) ?? { widths: [], heights: [], count: 0 }
      size.widths.push({ min: c.widthNorm.min, max: c.widthNorm.max })
      size.heights.push({ min: c.heightNorm.min, max: c.heightNorm.max })
      size.count += c.count
      sizeMap.set(c.label, size)
    }
  }

  const perClass = [...perClassMap.values()]
    .map((e) => ({
      ...e,
      imageCount: e.perImage.filter((p) => p.count > 0).length,
      avgConfidence: e.confCount > 0 ? r3(e.confSum / e.confCount) : 0,
    }))
    .sort((a, b) => b.totalCount - a.totalCount)

  const sizeRanges = [...sizeMap.entries()]
    .map(([label, s]) => ({
      label,
      widthRange: [Math.min(...s.widths.map((w) => w.min)), Math.max(...s.widths.map((w) => w.max))] as [number, number],
      heightRange: [Math.min(...s.heights.map((h) => h.min)), Math.max(...s.heights.map((h) => h.max))] as [number, number],
      sampleCount: s.count,
    }))
    .sort((a, b) => b.sampleCount - a.sampleCount)

  const patterns: StructurePattern[] = []

  // 1) 用量模式：同类元素在多张图中反复出现
  for (const c of perClass) {
    const counts = c.perImage.filter((p) => p.count > 0).map((p) => p.count)
    if (comparedCount >= 2 && c.imageCount >= Math.max(2, Math.ceil(comparedCount * 0.6)) && c.totalCount >= 3) {
      const partial = c.imageCount < comparedCount
      patterns.push({
        kind: 'usage',
        label: c.label,
        imageCount: c.imageCount,
        totalElements: c.totalCount,
        avgConfidence: c.avgConfidence,
        countRange: [Math.min(...counts), Math.max(...counts)],
        partial,
        text: `「${c.label}」在 ${c.imageCount}/${comparedCount} 张图中反复出现（共 ${c.totalCount} 个，每图 ${Math.min(...counts)}–${Math.max(...counts)} 个）${partial ? '——需要更多截图' : ''}`,
      })
    } else if (c.totalCount >= 4 && c.imageCount >= 1 && c.imageCount < comparedCount) {
      patterns.push({
        kind: 'usage',
        label: c.label,
        imageCount: c.imageCount,
        totalElements: c.totalCount,
        avgConfidence: c.avgConfidence,
        countRange: [Math.min(...counts), Math.max(...counts)],
        partial: true,
        text: `「${c.label}」仅在 ${c.imageCount}/${comparedCount} 张图中出现（共 ${c.totalCount} 个）——需要更多截图验证是否为稳定规律`,
      })
    }
  }

  // 2) 尺寸模式：同类元素归一化尺寸在各图中接近
  for (const c of perClass) {
    const perImageAvg = items
      .map((item) => item.features.classes.find((cls) => cls.label === c.label))
      .filter((cls): cls is StructureClassStats => cls !== undefined)
    if (perImageAvg.length < 2) continue
    const sampleCount = perImageAvg.reduce((a, cls) => a + cls.count, 0)
    if (sampleCount < 3) continue
    const avgWidths = perImageAvg.map((cls) => cls.widthNorm.avg)
    const spread = Math.max(...avgWidths) - Math.min(...avgWidths)
    if (spread <= 0.05 && Math.max(...avgWidths) > 0) {
      patterns.push({
        kind: 'size',
        label: c.label,
        imageCount: perImageAvg.length,
        totalElements: sampleCount,
        avgConfidence: c.avgConfidence,
        avgWidthRange: [r3(Math.min(...avgWidths)), r3(Math.max(...avgWidths))],
        text: `「${c.label}」归一化宽度在各图中接近（平均 ${r3(Math.min(...avgWidths))}–${r3(Math.max(...avgWidths))} 页宽占比，${sampleCount} 个样本）`,
      })
    }
  }

  // 3) 对齐模式：同类元素的行/列排列在多张图中反复出现
  const alignmentAgg = new Map<
    string,
    { label: string; axis: 'row' | 'column'; counts: number[]; files: string[] }
  >()
  for (const item of items) {
    const seen = new Set<string>()
    for (const a of item.features.alignments) {
      const key = `${a.label}|${a.axis}`
      // 每张图内同类同轴向只取最大簇，避免重复计数
      if (seen.has(key)) continue
      seen.add(key)
      const maxOfKind = Math.max(
        ...item.features.alignments
          .filter((x) => x.label === a.label && x.axis === a.axis)
          .map((x) => x.count),
      )
      const entry = alignmentAgg.get(key) ?? { label: a.label, axis: a.axis, counts: [], files: [] }
      entry.counts.push(maxOfKind)
      entry.files.push(item.fileName)
      alignmentAgg.set(key, entry)
    }
  }
  for (const entry of alignmentAgg.values()) {
    if (entry.counts.length < 2) continue
    const maxCluster = Math.max(...entry.counts)
    if (maxCluster < 3) continue
    patterns.push({
      kind: 'alignment',
      label: entry.label,
      imageCount: entry.counts.length,
      totalElements: entry.counts.reduce((a, b) => a + b, 0),
      avgConfidence: 0,
      axis: entry.axis,
      maxCluster,
      text: `「${entry.label}」以${entry.axis === 'row' ? '水平一行' : '纵向一列'}排列（${entry.counts.length}/${comparedCount} 张图，每${entry.axis === 'row' ? '行' : '列'}最多 ${maxCluster} 个）`,
    })
  }

  patterns.sort((a, b) => b.imageCount - a.imageCount || b.totalElements - a.totalElements)

  return { comparedCount, perClass, sizeRanges, patterns }
}
