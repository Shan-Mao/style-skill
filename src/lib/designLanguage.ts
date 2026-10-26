/**
 * 设计语言解读：把确定性图像特征转换为可读结论。
 *
 * 全部规则为固定阈值，阈值来源为经验设定，仅用于快速理解数据，
 * 不代表设计规范。每条 Reading 标注 实测/推断 与依据指标，
 * 便于用户区分原始测量与解读性结论。
 */

import type { ImageFeatures } from './imageFeatures'
import type { ImportedImage } from './imageImport'
import { matchColorGroups, spatialCrossStats } from './crossImage'
import { CROSS_COLOR_DISTANCE } from './crossImage'

export type Reading = {
  text: string
  /** 实测 = 直接陈述测量结果；推断 = 基于阈值的解读 */
  kind: 'measured' | 'inferred'
  /** 结论依据的指标 */
  basis: string
  /** 结论涉及的图片（多图场景） */
  sources?: string[]
}

/** 当前确定性指标无法可靠判断、需后续阶段或人工确认的维度 */
export const UNANALYZED_ITEMS = [
  '圆角与描边',
  '阴影与投影',
  '字体族与字号层级',
  '按钮与交互组件样式',
  '图标风格',
  '动效',
]

// ---- 分档规则（经验阈值） ----

export function luminanceBand(mean: number): string {
  if (mean < 85) return '偏暗'
  if (mean <= 170) return '中等'
  return '偏亮'
}

export function contrastBand(std: number): string {
  if (std < 40) return '对比较弱'
  if (std <= 80) return '对比中等'
  return '对比强烈'
}

export function complexityBand(density: number): string {
  if (density < 0.02) return '简洁'
  if (density <= 0.08) return '中等'
  return '复杂'
}

function dominantDirection(bins: number[]): { name: string; share: number } | null {
  if (!bins.some((v) => v > 0)) return null
  const candidates: Array<{ name: string; share: number }> = [
    { name: '水平', share: bins[0] + bins[5] },
    { name: '垂直', share: bins[3] },
    { name: '斜向', share: bins[1] + bins[2] + bins[4] },
  ]
  candidates.sort((a, b) => b.share - a.share)
  return candidates[0].share >= 0.45 ? candidates[0] : null
}

// ---- 空间网格辅助 ----

const ROW_NAMES = ['顶部', '上部', '下部', '底部']
const COL_NAMES = ['左侧', '左中', '右中', '右侧']

export function regionName(cell: number): string {
  return `${COL_NAMES[cell % 4]}${ROW_NAMES[Math.floor(cell / 4)]}`
}

function finiteMean(values: number[]): number | null {
  const vs = values.filter(Number.isFinite)
  return vs.length > 0 ? vs.reduce((a, b) => a + b, 0) / vs.length : null
}

const TOP_CELLS = [0, 1, 2, 3]
const BOTTOM_CELLS = [12, 13, 14, 15]
const LEFT_CELLS = [0, 4, 8, 12]
const RIGHT_CELLS = [3, 7, 11, 15]

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`

function layoutObservations(f: ImageFeatures): string[] {
  const obs: string[] = []
  const lum = f.grid.luminance

  const topLum = finiteMean(TOP_CELLS.map((i) => lum[i]))
  const bottomLum = finiteMean(BOTTOM_CELLS.map((i) => lum[i]))
  if (topLum != null && bottomLum != null) {
    const diff = Math.round(Math.abs(topLum - bottomLum))
    if (diff >= 30) {
      obs.push(`${bottomLum > topLum ? '下半部' : '上半部'}明显更亮（上下亮度差 ${diff}/255）`)
    }
  }
  const leftLum = finiteMean(LEFT_CELLS.map((i) => lum[i]))
  const rightLum = finiteMean(RIGHT_CELLS.map((i) => lum[i]))
  if (leftLum != null && rightLum != null) {
    const diff = Math.round(Math.abs(leftLum - rightLum))
    if (diff >= 30) {
      obs.push(`${rightLum > leftLum ? '右侧' : '左侧'}明显更亮（左右亮度差 ${diff}/255）`)
    }
  }

  const edge = f.grid.edgeDensity
  const overall = f.edgeDensity
  if (overall > 0.005) {
    const topEdge = finiteMean(TOP_CELLS.map((i) => edge[i]))
    const bottomEdge = finiteMean(BOTTOM_CELLS.map((i) => edge[i]))
    const leftEdge = finiteMean(LEFT_CELLS.map((i) => edge[i]))
    const rightEdge = finiteMean(RIGHT_CELLS.map((i) => edge[i]))
    if (topEdge != null && topEdge >= overall * 1.8) {
      obs.push(`顶部边缘密度高（${pct(topEdge)}，全页 ${pct(overall)}），可能与页头或导航相关（需确认）`)
    } else if (bottomEdge != null && bottomEdge >= overall * 1.8) {
      obs.push(`底部边缘密度高（${pct(bottomEdge)}，全页 ${pct(overall)}），可能与页脚相关（需确认）`)
    }
    if (
      leftEdge != null &&
      leftEdge >= overall * 1.8 &&
      (rightEdge == null || leftEdge > rightEdge * 1.5)
    ) {
      obs.push(`左侧边缘密度高（${pct(leftEdge)}，全页 ${pct(overall)}），可能与侧边栏相关（需确认）`)
    } else if (
      rightEdge != null &&
      rightEdge >= overall * 1.8 &&
      (leftEdge == null || rightEdge > leftEdge * 1.5)
    ) {
      obs.push(`右侧边缘密度高（${pct(rightEdge)}，全页 ${pct(overall)}），可能与侧栏或固定操作区相关（需确认）`)
    }
  }

  if (obs.length === 0) {
    obs.push('各区域明度与边缘分布相对均匀，未见明显的布局分区信号')
  }
  return obs
}

// ---- 单图解读 ----

export function describeImage(f: ImageFeatures): Reading[] {
  const readings: Reading[] = []
  const mean = Math.round(f.meanLuminance)
  const std = Math.round(f.luminanceStd)

  readings.push({
    text: `整体基调${luminanceBand(f.meanLuminance)}（平均亮度 ${mean}/255）`,
    kind: 'inferred',
    basis: '明度分布·平均亮度',
  })
  readings.push({
    text: `明暗${contrastBand(f.luminanceStd)}（亮度标准差 ${std}）`,
    kind: 'inferred',
    basis: '明度分布·对比度',
  })

  const top3 = f.colors.slice(0, 3).reduce((a, c) => a + c.ratio, 0)
  const top6 = f.colors.reduce((a, c) => a + c.ratio, 0)
  let colorText: string
  if (f.colors.length === 0) {
    colorText = '没有可统计的不透明像素，无法判断色彩'
  } else if (f.colors[0].ratio >= 0.6) {
    colorText = `存在绝对主色 ${f.colors[0].hex}（占 ${pct(f.colors[0].ratio, 0)}）`
  } else if (top3 >= 0.75) {
    colorText = `色彩高度集中（前 3 色合计 ${pct(top3, 0)}）`
  } else if (top6 < 0.45) {
    colorText = `色彩分散（前 6 色合计仅 ${pct(top6, 0)}）`
  } else {
    colorText = `色彩较为集中（前 3 色合计 ${pct(top3, 0)}）`
  }
  readings.push({ text: colorText, kind: 'inferred', basis: '颜色分布' })

  readings.push({
    text: `视觉复杂度${complexityBand(f.edgeDensity)}（边缘像素占比 ${pct(f.edgeDensity)}）`,
    kind: 'inferred',
    basis: '边缘密度（阈值为经验值）',
  })

  const dir = dominantDirection(f.orientation)
  if (dir) {
    const hint =
      dir.name === '水平'
        ? '可能对应横向分隔与栏位排版'
        : dir.name === '垂直'
          ? '可能对应纵向列表与栏栅'
          : '可能对应斜切或装饰性排版'
    readings.push({
      text: `边缘方向以${dir.name}为主（合计 ${pct(dir.share, 0)}），${hint}（需确认）`,
      kind: 'inferred',
      basis: '线条方向',
    })
  }

  for (const obs of layoutObservations(f)) {
    readings.push({ text: obs, kind: 'inferred', basis: '空间分布·4×4 网格' })
  }
  return readings
}

// ---- 多图对比 ----

export type ImageComparison = {
  stable: Reading[]
  differences: Reading[]
}

export function compareImages(images: ImportedImage[]): ImageComparison {
  const n = images.length
  const allNames = images.map((i) => i.fileName)
  const stable: Reading[] = []
  const differences: Reading[] = []

  // 明度基调
  const means = images.map((i) => i.features.meanLuminance)
  const meanBands = new Set(images.map((i) => luminanceBand(i.features.meanLuminance)))
  const maxMeanI = means.indexOf(Math.max(...means))
  const minMeanI = means.indexOf(Math.min(...means))
  if (meanBands.size === 1) {
    stable.push({
      text: `全部图片整体基调${[...meanBands][0]}（平均亮度 ${Math.round(Math.min(...means))}–${Math.round(Math.max(...means))}/255）`,
      kind: 'inferred',
      basis: '明度分布·平均亮度',
      sources: allNames,
    })
    if (Math.max(...means) - Math.min(...means) >= 60) {
      differences.push({
        text: `${images[maxMeanI].fileName} 比其他图片明显更亮（平均亮度差 ${Math.round(Math.max(...means) - Math.min(...means))}/255）`,
        kind: 'inferred',
        basis: '明度分布·平均亮度',
        sources: [images[maxMeanI].fileName, images[minMeanI].fileName],
      })
    }
  } else {
    differences.push({
      text: `明暗基调不一致：${images[minMeanI].fileName} 偏暗（${Math.round(means[minMeanI])}），${images[maxMeanI].fileName} 偏亮（${Math.round(means[maxMeanI])}）`,
      kind: 'inferred',
      basis: '明度分布·平均亮度',
      sources: [images[minMeanI].fileName, images[maxMeanI].fileName],
    })
  }

  // 对比度
  const stds = images.map((i) => i.features.luminanceStd)
  const stdBands = new Set(images.map((i) => contrastBand(i.features.luminanceStd)))
  if (stdBands.size === 1) {
    stable.push({
      text: `明暗对比在所有图片中${[...stdBands][0]}（亮度标准差 ${Math.round(Math.min(...stds))}–${Math.round(Math.max(...stds))}）`,
      kind: 'inferred',
      basis: '明度分布·对比度',
      sources: allNames,
    })
  } else {
    const maxStdI = stds.indexOf(Math.max(...stds))
    const minStdI = stds.indexOf(Math.min(...stds))
    if (stds[maxStdI] >= stds[minStdI] * 1.8 && stds[maxStdI] - stds[minStdI] >= 20) {
      differences.push({
        text: `${images[maxStdI].fileName} 的明暗对比明显更强（标准差 ${Math.round(stds[maxStdI])}，${images[minStdI].fileName} 仅 ${Math.round(stds[minStdI])}）`,
        kind: 'inferred',
        basis: '明度分布·对比度',
        sources: [images[maxStdI].fileName, images[minStdI].fileName],
      })
    }
  }

  // 复杂度
  const edges = images.map((i) => i.features.edgeDensity)
  const cBands = new Set(images.map((i) => complexityBand(i.features.edgeDensity)))
  if (cBands.size === 1) {
    stable.push({
      text: `视觉复杂度一致：${[...cBands][0]}（边缘密度 ${pct(Math.min(...edges))}–${pct(Math.max(...edges))}）`,
      kind: 'inferred',
      basis: '边缘密度',
      sources: allNames,
    })
  }
  const maxEdgeI = edges.indexOf(Math.max(...edges))
  const minEdgeI = edges.indexOf(Math.min(...edges))
  if (
    edges[maxEdgeI] >= edges[minEdgeI] * 2.5 &&
    edges[maxEdgeI] - edges[minEdgeI] >= 0.015
  ) {
    differences.push({
      text: `${images[maxEdgeI].fileName} 的视觉复杂度明显更高（边缘密度 ${pct(edges[maxEdgeI])}，${images[minEdgeI].fileName} 为 ${pct(edges[minEdgeI])}）`,
      kind: 'inferred',
      basis: '边缘密度',
      sources: [images[maxEdgeI].fileName, images[minEdgeI].fileName],
    })
  }

  // 颜色
  const groups = matchColorGroups(images)
  const inAll = groups.filter((g) => g.imageCount === n)
  for (const g of inAll.slice(0, 3)) {
    stable.push({
      text: `主色 ${g.hex} 出现在全部 ${n} 张图片（占比 ${pct(g.minRatio, 0)}–${pct(g.maxRatio, 0)}）`,
      kind: 'inferred',
      basis: `颜色分布·跨图匹配（RGB 距离 ≤ ${CROSS_COLOR_DISTANCE}）`,
      sources: g.entries.map((e) => e.fileName),
    })
  }
  for (const g of groups
    .filter((g) => g.imageCount === 1 && g.entries[0].ratio >= 0.05)
    .slice(0, 3)) {
    differences.push({
      text: `${g.entries[0].fileName} 含独有主色 ${g.hex}（占 ${pct(g.entries[0].ratio, 0)}）`,
      kind: 'inferred',
      basis: '颜色分布·跨图匹配',
      sources: [g.entries[0].fileName],
    })
  }

  // 线条方向
  const dirs = images.map((i) => dominantDirection(i.features.orientation))
  const nonNull = dirs.filter((d): d is { name: string; share: number } => d !== null)
  const dirNames = new Set(nonNull.map((d) => d.name))
  if (nonNull.length >= Math.max(2, n - 1) && dirNames.size === 1) {
    stable.push({
      text: `线条方向一致：以${[...dirNames][0]}边缘为主（${nonNull.length}/${n} 张图片）`,
      kind: 'inferred',
      basis: '线条方向',
      sources: allNames,
    })
  }

  // 空间分布
  const sc = spatialCrossStats(images)
  const finiteAvg = sc.avgEdgeDensity.filter(Number.isFinite)
  const overallAvg =
    finiteAvg.length > 0 ? finiteAvg.reduce((a, b) => a + b, 0) / finiteAvg.length : 0
  const busyStable: number[] = []
  for (let cell = 0; cell < 16; cell++) {
    if (
      sc.validCounts[cell] === n &&
      sc.avgEdgeDensity[cell] >= overallAvg * 1.5 &&
      sc.stdEdgeDensity[cell] <= 0.012
    ) {
      busyStable.push(cell)
    }
  }
  busyStable.sort((a, b) => sc.avgEdgeDensity[b] - sc.avgEdgeDensity[a])
  for (const cell of busyStable.slice(0, 2)) {
    stable.push({
      text: `${regionName(cell)}区域在所有图片中边缘密度均较高（${pct(sc.avgEdgeDensity[cell])}，全页平均 ${pct(overallAvg)}），可能为固定结构区域（需确认）`,
      kind: 'inferred',
      basis: '空间分布·边缘网格',
      sources: allNames,
    })
  }

  let varyCell = -1
  let varyStd = -1
  for (let cell = 0; cell < 16; cell++) {
    if (sc.validCounts[cell] >= 2 && sc.stdEdgeDensity[cell] > varyStd) {
      varyStd = sc.stdEdgeDensity[cell]
      varyCell = cell
    }
  }
  if (varyCell >= 0 && varyStd >= 0.02) {
    differences.push({
      text: `${regionName(varyCell)}区域在各图间差异最大（边缘密度 ${pct(sc.minEdgeDensity[varyCell])}–${pct(sc.maxEdgeDensity[varyCell])}）`,
      kind: 'inferred',
      basis: '空间分布·边缘网格',
      sources: allNames,
    })
  }

  if (stable.length === 0) {
    stable.push({
      text: '未发现跨图片稳定一致的视觉特征（图片差异较大或样本较少）',
      kind: 'measured',
      basis: '全部指标',
    })
  }
  if (differences.length === 0) {
    differences.push({
      text: '未发现明显差异：各图在明度、对比度、复杂度与主色上较为接近',
      kind: 'measured',
      basis: '全部指标',
    })
  }
  return { stable, differences }
}
