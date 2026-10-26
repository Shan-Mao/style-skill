/**
 * 设计规则：把图像分析结果转化为用户可审阅、修改、确认的设计规范。
 *
 * 数据结构为下一阶段 Skill 生成预留了直接映射：
 * - 颜色类规则（value 为 #RRGGBB）→ CSS 设计令牌；
 * - 已确认的规则 → 编码助手可引用的设计约束 / 视觉验收清单条目；
 * - 组件与排版类规则 → 组件实现建议的人工输入位。
 *
 * 初始化复用 designLanguage / crossImage 的既有推断，
 * 不在此处复制规则推断逻辑。
 */

import { compareImages, complexityBand, contrastBand, describeImage, luminanceBand } from './designLanguage'
import { matchColorGroups } from './crossImage'
import type { ImportedImage } from './imageImport'
import type { DetectionStateMap, DetectionSuccess } from './detectionClient'
import { compareStructures, extractStructureFeatures } from './structureFeatures'

export type RuleCategory = 'color' | 'layout' | 'hierarchy' | 'component' | 'typography'
export type RuleStatus = 'pending' | 'confirmed' | 'ignored'
/** 与 Reading.kind 对齐，另加 manual（用户手动输入） */
export type RuleSource = 'measured' | 'inferred' | 'manual'

export type RuleImageRef = { id: string; name: string }

export type DesignRule = {
  id: string
  category: RuleCategory
  name: string
  /** 当前值或建议值：颜色为 #RRGGBB，其余为文字描述 */
  value: string
  status: RuleStatus
  source: RuleSource
  /** 证据说明（引用了什么指标、什么数据） */
  evidence: string
  /** 关联图片快照（图片可能已被移除，按 id 查找） */
  sourceImages: RuleImageRef[]
  /** 用户修改过值；「从分析重新生成」不会覆盖 */
  edited?: boolean
  /** 用户手动创建（区别于初始化生成的"手动填写"占位规则），可删除 */
  custom?: boolean
}

export type ColorCandidate = { hex: string; imageCount: number; avgRatio: number }

export const CATEGORY_ORDER: RuleCategory[] = [
  'color',
  'layout',
  'hierarchy',
  'component',
  'typography',
]

export const CATEGORY_LABELS: Record<RuleCategory, string> = {
  color: '色彩系统',
  layout: '布局系统',
  hierarchy: '视觉层级',
  component: '组件风格',
  typography: '字体与排版',
}

export const STATUS_LABELS: Record<RuleStatus, string> = {
  pending: '待确认',
  confirmed: '已确认',
  ignored: '已忽略',
}

export const SOURCE_LABELS: Record<RuleSource, string> = {
  measured: '实测',
  inferred: '推断',
  manual: '手动',
}

/** 当前确定性指标无法自动检测、需人工填写的规则项 */
const MANUAL_COMPONENT_RULES = [
  '圆角风格',
  '边框与描边',
  '阴影与投影',
  '按钮样式',
  '输入框样式',
  '导航样式',
  '卡片样式',
]

const MANUAL_TYPOGRAPHY_RULES = [
  '字体族',
  '字号层级（标题 / 正文）',
  '字重层级',
  '行高与段落间距',
  '对齐方式',
]

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

function luminanceOf(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return (2126 * r + 7152 * g + 722 * b) / 10000
}

function saturationOf(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

export function isColorValue(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value)
}

/** 编辑器里的候选颜色：来自跨图颜色分组 */
export function colorCandidates(images: ImportedImage[]): ColorCandidate[] {
  return matchColorGroups(images)
    .filter((g) => g.avgRatio >= 0.004)
    .map((g) => ({ hex: g.hex, imageCount: g.imageCount, avgRatio: g.avgRatio }))
}

/**
 * 从 ScreenParser 检测结果生成结构类候选规则（同时供规则编辑器
 * 判断「有新证据待纳入」：对比候选名与现有规则名）。
 * 只有存在明确证据（跨图重复 / 尺寸一致 / 对齐模式）时才生成，
 * 每条记录支持图片、样本数与不确定性说明；不足时标注"需要更多截图"。
 */
export function structureRuleCandidates(
  images: ImportedImage[],
  detections: DetectionStateMap,
): DesignRule[] {
  const done = images.filter((img) => detections[img.id]?.status === 'done')
  if (done.length === 0) return []

  const items = done.map((img) => ({
    fileName: img.fileName,
    features: extractStructureFeatures(
      (detections[img.id] as { status: 'done'; result: DetectionSuccess }).result,
    ),
  }))
  const comparison = compareStructures(items)
  const comparedCount = comparison.comparedCount
  const srcImages = done.map((i) => ({ id: i.id, name: i.fileName }))
  const MODEL_NOTE =
    '检测来自本地 ScreenParser 模型（模型推断，非 DOM 实测），坐标与尺寸均为归一化检测框统计'

  const mk = (name: string, value: string, evidence: string): DesignRule => ({
    id: crypto.randomUUID(),
    category: 'layout',
    name,
    value,
    status: 'pending',
    source: 'inferred',
    evidence,
    sourceImages: srcImages,
  })

  const candidates: DesignRule[] = []

  const usage = comparison.patterns.filter((p) => p.kind === 'usage').slice(0, 4)
  for (const p of usage) {
    const range = p.countRange ?? [p.totalElements, p.totalElements]
    candidates.push(
      mk(
        `结构·常用元素（${p.label}）`,
        p.partial
          ? `共 ${p.totalElements} 个（${p.imageCount}/${comparedCount} 张图，覆盖不全）`
          : `每图 ${range[0]}–${range[1]} 个（${p.imageCount}/${comparedCount} 张图）`,
        `ScreenParser 检测：「${p.label}」在 ${p.imageCount} 张截图中共出现 ${p.totalElements} 个，平均置信度 ${Math.round(p.avgConfidence * 100)}%。${MODEL_NOTE}。${p.partial ? `仅覆盖 ${p.imageCount}/${comparedCount} 张图，需要更多截图验证跨图一致性。` : '跨图重复出现是结构规律的候选证据。'}请结合截图确认。`,
      ),
    )
  }

  const size = comparison.patterns.filter((p) => p.kind === 'size').slice(0, 3)
  for (const p of size) {
    const range = p.avgWidthRange ?? [0, 0]
    candidates.push(
      mk(
        `结构·${p.label} 尺寸一致性`,
        `归一化宽度 ${range[0]}–${range[1]} 页宽占比（${p.totalElements} 个样本）`,
        `各图中「${p.label}」的平均归一化宽度差异 ≤5% 页宽（${p.imageCount} 张图、${p.totalElements} 个检测框）。${MODEL_NOTE}；检测框尺寸不等同于 CSS 实际渲染尺寸，需人工确认。`,
      ),
    )
  }

  const alignment = comparison.patterns.filter((p) => p.kind === 'alignment').slice(0, 3)
  for (const p of alignment) {
    const axisText = p.axis === 'row' ? '水平一行排列' : '纵向一列堆叠'
    candidates.push(
      mk(
        `结构·${p.label} ${p.axis === 'row' ? '水平排列' : '纵向堆叠'}`,
        `${axisText}（${p.imageCount}/${comparedCount} 张图，每${p.axis === 'row' ? '行' : '列'}最多 ${p.maxCluster} 个）`,
        `对齐判定基于同类元素归一化中心点聚类（行容差 2.5% 页高 / 列容差 2% 页宽），${p.imageCount} 张图呈现一致模式。${MODEL_NOTE}；不推断具体间距（gap）或 CSS 属性。`,
      ),
    )
  }

  return candidates.slice(0, 8)
}

/**
 * 从当前图片的分析结果初始化规则。
 * 可靠测量的给建议值；无法可靠判断的只建待确认项，不伪造结论。
 * detections 提供时，追加基于 ScreenParser 检测证据的结构候选规则。
 */
export function buildInitialRules(
  images: ImportedImage[],
  detections?: DetectionStateMap,
): DesignRule[] {
  if (images.length === 0) return []
  const n = images.length
  const imgRefs: RuleImageRef[] = images.map((i) => ({ id: i.id, name: i.fileName }))
  const rules: DesignRule[] = []

  const mk = (
    category: RuleCategory,
    name: string,
    value: string,
    source: RuleSource,
    evidence: string,
  ): DesignRule => ({
    id: crypto.randomUUID(),
    category,
    name,
    value,
    status: 'pending',
    source,
    evidence,
    sourceImages: imgRefs,
  })

  const groups = matchColorGroups(images).filter((g) => g.avgRatio >= 0.004)

  // ---- 色彩系统 ----

  const byRatio = [...groups].sort((a, b) => b.avgRatio - a.avgRatio)
  const bg = byRatio[0]
  rules.push(
    mk(
      'color',
      '页面背景色',
      bg?.hex ?? '',
      bg ? 'measured' : 'manual',
      bg
        ? `跨图平均占比最大的颜色（${pct(bg.avgRatio, 0)}，出现在 ${bg.imageCount}/${n} 张图）。“背景”角色按占比推测，请结合图片确认。`
        : '没有可统计的颜色，请手动指定。',
    ),
  )

  const bgLum = bg ? luminanceOf(bg.hex) : 128
  const presenceMin = n === 1 ? 1 : Math.max(2, Math.ceil(n / 2))
  const accent = groups
    .filter((g) => g.imageCount >= presenceMin && saturationOf(g.hex) > 0.25)
    .sort((a, b) => saturationOf(b.hex) - saturationOf(a.hex))[0]
  rules.push(
    mk(
      'color',
      '主色 / 强调色',
      accent?.hex ?? '',
      accent ? 'inferred' : 'manual',
      accent
        ? `出现在 ${accent.imageCount}/${n} 张图且饱和度较高（${Math.round(saturationOf(accent.hex) * 100)}%）的共有颜色，推测为品牌或强调色——需确认。`
        : '未找到高饱和度的共有颜色，请从候选颜色中指定或手动填写。',
    ),
  )

  const others = groups.filter((g) => g !== bg && g.avgRatio >= 0.003)
  const textPick =
    bgLum >= 128
      ? [...others].sort((a, b) => luminanceOf(a.hex) - luminanceOf(b.hex))[0]
      : [...others].sort((a, b) => luminanceOf(b.hex) - luminanceOf(a.hex))[0]
  rules.push(
    mk(
      'color',
      '正文文字色',
      textPick?.hex ?? '',
      textPick ? 'inferred' : 'manual',
      textPick
        ? `背景偏${bgLum >= 128 ? '亮' : '暗'}，此处取对比最强的${bgLum >= 128 ? '最暗' : '最亮'}次要颜色（${textPick.hex}，平均占比 ${pct(textPick.avgRatio, 0)}）——启发式推测，需确认。`
        : '没有可用的候选颜色，请手动指定。',
    ),
  )

  rules.push(
    mk('color', '次级文字色', '', 'manual', '请从候选颜色中选择比正文文字色更弱的颜色，或手动填写。'),
  )
  rules.push(
    mk('color', '边框与分隔线色', '', 'manual', '请从候选颜色中选择低饱和度的浅色（常见于分隔线），或手动填写。'),
  )

  // ---- 布局系统 ----

  const comparison = compareImages(images)
  const spatialReadings = [...comparison.stable, ...comparison.differences].filter((r) =>
    r.basis.includes('空间分布'),
  )
  rules.push(
    mk(
      'layout',
      '页面布局特征',
      spatialReadings.length > 0
        ? spatialReadings.map((r) => r.text).join('；')
        : '各图空间分布较为均匀，未见一致的布局信号',
      'inferred',
      '来自「多图汇总 · 空间分布差异」的跨图网格统计。',
    ),
  )

  const avgEdge = images.reduce((a, i) => a + i.features.edgeDensity, 0) / n
  rules.push(
    mk(
      'layout',
      '视觉密度',
      `${complexityBand(avgEdge)}（各图平均边缘密度 ${pct(avgEdge)}）`,
      'inferred',
      `各图边缘密度 ${images.map((i) => pct(i.features.edgeDensity)).join(' / ')}；分档为经验规则。`,
    ),
  )

  rules.push(
    mk('layout', '内容宽度倾向', '', 'manual', '无法从当前统计可靠判断内容区宽度，请对照截图确认。'),
  )
  rules.push(
    mk('layout', '留白节奏', '', 'manual', '留白测量需要组件级检测支持，当前无法可靠判断，请人工确认。'),
  )

  // ---- 视觉层级 ----

  const means = images.map((i) => i.features.meanLuminance)
  const stds = images.map((i) => i.features.luminanceStd)
  rules.push(
    mk(
      'hierarchy',
      '页面明暗基调',
      `${luminanceBand(means.reduce((a, b) => a + b, 0) / n)}（各图平均亮度 ${Math.round(Math.min(...means))}–${Math.round(Math.max(...means))}/255）`,
      'inferred',
      `各图平均亮度：${images.map((i) => `${i.fileName} ${Math.round(i.features.meanLuminance)}`).join('、')}。`,
    ),
  )
  rules.push(
    mk(
      'hierarchy',
      '明暗对比',
      `${contrastBand(stds.reduce((a, b) => a + b, 0) / n)}（各图亮度标准差 ${Math.round(Math.min(...stds))}–${Math.round(Math.max(...stds))}）`,
      'inferred',
      '标准差越大代表明暗差异越强；各图数值见「多图汇总 · 明度与对比度」。',
    ),
  )

  const regionObs = images.flatMap((img) =>
    describeImage(img.features)
      .filter(
        (r) => r.basis === '空间分布·4×4 网格' && (r.text.includes('更亮') || r.text.includes('边缘密度高')),
      )
      .map((r) => `${img.fileName}：${r.text}`),
  )
  rules.push(
    mk(
      'hierarchy',
      '主要与次要区域',
      regionObs.length > 0 ? regionObs.join('；') : '未检测到明显的区域明暗或密度差异',
      'inferred',
      '来自各图「设计语言初判 · 空间分布」的确定性观察。',
    ),
  )

  // ---- 组件风格（无法自动检测，仅建待确认项） ----
  for (const name of MANUAL_COMPONENT_RULES) {
    rules.push(
      mk('component', name, '', 'manual', '当前确定性指标无法自动检测该属性，请对照参考图人工确认后填写。'),
    )
  }

  // ---- 字体与排版（无法自动检测，仅建待确认项） ----
  for (const name of MANUAL_TYPOGRAPHY_RULES) {
    rules.push(
      mk('typography', name, '', 'manual', '当前无法从截图统计中可靠识别文字属性，请人工确认后填写。'),
    )
  }

  // ---- 结构候选（ScreenParser 检测证据，走同样的待确认流程） ----
  if (detections) {
    rules.push(...structureRuleCandidates(images, detections))
  }

  return rules
}

/**
 * 「从分析重新生成」的合并策略：
 * 已编辑 / 已确认 / 已忽略的规则保留用户版本，
 * 只有未改动的待确认规则会被新建议刷新；手动规则始终保留。
 */
export function mergeRules(existing: DesignRule[], fresh: DesignRule[]): DesignRule[] {
  const key = (r: DesignRule) => `${r.category}:${r.name}`
  const existingByKey = new Map(existing.map((r) => [key(r), r]))
  const merged = fresh.map((f) => {
    const old = existingByKey.get(key(f))
    if (!old) return f
    if (old.status !== 'pending' || old.edited || old.custom) return old
    return f
  })
  const freshKeys = new Set(fresh.map(key))
  for (const old of existing) {
    if (!freshKeys.has(key(old))) merged.push(old)
  }
  return merged
}
