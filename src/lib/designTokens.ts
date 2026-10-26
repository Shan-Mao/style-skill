/**
 * 设计令牌生成：把「已确认且有明确值」的设计规则转换为
 * tokens.css（CSS 自定义属性）与 tokens.json（含溯源元数据）。
 *
 * 纯逻辑模块，与 React UI 分离：
 * - 只有 status === 'confirmed' 且值可解析的规则进入正式令牌；
 * - 待确认 / 已忽略 / 空值 / 无法解析的规则不进入；
 *   已确认但不可转换的规则会给出原因；
 * - 重名令牌追加 -2/-3 后缀并记录警告，不静默覆盖；
 * - 不编造任何默认值，候选颜色不等于已确认规范。
 */

import type { DesignRule, RuleSource } from './designRules'

export type TokenType = 'color' | 'spacing' | 'radius' | 'shadow' | 'font' | 'border'

export type DesignToken = {
  /** kebab-case 令牌名（不含 -- 前缀），如 color-bg */
  name: string
  cssVar: string
  value: string
  type: TokenType
  /** 人类可读说明（取自规则名） */
  description: string
  ruleId: string
  ruleName: string
  ruleSource: RuleSource
}

export type SkippedRule = { ruleId: string; ruleName: string; reason: string }

export type TokenResult = {
  tokens: DesignToken[]
  skipped: SkippedRule[]
  warnings: string[]
  css: string
  json: string
}

export const TOKEN_TYPE_ORDER: TokenType[] = [
  'color',
  'spacing',
  'radius',
  'shadow',
  'font',
  'border',
]

export const TOKEN_TYPE_LABELS: Record<TokenType, string> = {
  color: '颜色',
  spacing: '间距',
  radius: '圆角',
  shadow: '阴影',
  font: '字体',
  border: '边框',
}

type KnownMapping = { names: string[]; token: string; type: TokenType }

/** 已知规则名 → 令牌名/类型（与 designRules.buildInitialRules 的命名对应） */
const KNOWN_MAPPINGS: KnownMapping[] = [
  { names: ['页面背景色'], token: 'color-bg', type: 'color' },
  { names: ['主色 / 强调色', '主色', '强调色'], token: 'color-primary', type: 'color' },
  { names: ['辅助色', '次要色'], token: 'color-secondary', type: 'color' },
  { names: ['正文文字色', '正文字色'], token: 'color-text', type: 'color' },
  { names: ['次级文字色', '次要文字色'], token: 'color-text-secondary', type: 'color' },
  { names: ['标题文字色', '标题色'], token: 'color-text-heading', type: 'color' },
  { names: ['边框与分隔线色', '分隔线色'], token: 'color-border', type: 'color' },
  { names: ['链接色'], token: 'color-link', type: 'color' },
  { names: ['卡片背景色'], token: 'color-bg-card', type: 'color' },
  { names: ['圆角风格', '圆角'], token: 'radius-base', type: 'radius' },
  { names: ['阴影与投影', '阴影'], token: 'shadow-base', type: 'shadow' },
  { names: ['字体族'], token: 'font-family-base', type: 'font' },
  { names: ['边框与描边'], token: 'border-base', type: 'border' },
]

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const DIMENSION_RE = /^-?\d+(\.\d+)?(px|rem|em|%)$/
/** 阴影 / 字体 / 边框等自由文本的宽松白名单（禁止注入换行、分号、花括号等） */
const SAFE_TEXT_RE = /^[-\w\u4e00-\u9fa5"'\s(),.%]+$/

function normalizeHex(raw: string): string | null {
  const m = raw.trim().match(HEX_RE)
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return `#${h.toUpperCase()}`
}

function parseDimension(raw: string): string | null {
  return DIMENSION_RE.test(raw.trim()) ? raw.trim() : null
}

function parseSafeText(raw: string, mustHaveDigit: boolean): string | null {
  const v = raw.trim()
  if (v.length === 0 || v.length > 120 || !SAFE_TEXT_RE.test(v)) return null
  if (mustHaveDigit && !/\d/.test(v)) return null
  return v
}

function parseValueAs(type: TokenType, raw: string): string | null {
  switch (type) {
    case 'color':
      return normalizeHex(raw)
    case 'spacing':
    case 'radius':
      return parseDimension(raw)
    case 'shadow':
      return parseSafeText(raw, true)
    case 'font':
      return parseSafeText(raw, false)
    case 'border':
      return parseSafeText(raw, true)
  }
}

const VALUE_HINT = {
  color: '颜色需为 #RRGGBB 格式',
  dimension: '尺寸需形如 8px / 1rem / 10%',
  shadow: '阴影需形如 0 2px 8px rgba(0,0,0,.15)',
}

function hintFor(type: TokenType): string {
  switch (type) {
    case 'color':
      return VALUE_HINT.color
    case 'spacing':
    case 'radius':
      return VALUE_HINT.dimension
    case 'shadow':
      return VALUE_HINT.shadow
    case 'font':
      return '字体需为字体族名称（如 "PingFang SC", sans-serif）'
    case 'border':
      return '边框需形如 1px solid #DDDDDD'
  }
}

/** 未知规则名的类型推断：结合名称提示与值的形态，判断不出则返回 null */
function inferFromName(
  name: string,
  raw: string,
): { type: TokenType; value: string } | null {
  const hex = normalizeHex(raw)
  if (hex) return { type: 'color', value: hex }
  if (DIMENSION_RE.test(raw.trim())) {
    if (/间距|留白|边距/.test(name)) return { type: 'spacing', value: raw.trim() }
    if (/圆角|弧度/.test(name)) return { type: 'radius', value: raw.trim() }
    if (/字号|字体大小|文字大小/.test(name)) return { type: 'font', value: raw.trim() }
    return null
  }
  if (/阴影|投影/.test(name)) {
    const v = parseSafeText(raw, true)
    if (v) return { type: 'shadow', value: v }
  }
  if (/字体|font/i.test(name)) {
    const v = parseSafeText(raw, false)
    if (v) return { type: 'font', value: v }
  }
  if (/边框|描边/.test(name)) {
    const v = parseSafeText(raw, true)
    if (v) return { type: 'border', value: v }
  }
  return null
}

function buildCss(tokens: DesignToken[]): string {
  const header = [
    '/* Style Skill 设计令牌',
    ' * 由已确认的设计规则生成；仅包含可明确转换的值，不含任何默认值。',
    ' * 令牌溯源与跳过原因见 tokens.json。',
    ' */',
    '',
    ':root {',
  ]
  const body = tokens.map(
    (t) => `  /* ${t.description}（来源规则：${t.ruleName}） */\n  ${t.cssVar}: ${t.value};`,
  )
  return [...header, ...body, '}', ''].join('\n')
}

function buildJson(
  tokens: DesignToken[],
  skipped: SkippedRule[],
  warnings: string[],
): string {
  return JSON.stringify(
    {
      meta: {
        generator: 'Style Skill 设计令牌生成器',
        tokenCount: tokens.length,
        skippedCount: skipped.length,
      },
      tokens: tokens.map((t) => ({
        name: t.name,
        cssVar: t.cssVar,
        value: t.value,
        type: t.type,
        description: t.description,
        sourceRule: { id: t.ruleId, name: t.ruleName, source: t.ruleSource },
      })),
      skipped,
      warnings,
    },
    null,
    2,
  )
}

/** 核心入口：从设计规则生成令牌与输出内容（纯函数，可测试） */
export function buildTokens(rules: DesignRule[]): TokenResult {
  const tokens: DesignToken[] = []
  const skipped: SkippedRule[] = []
  const warnings: string[] = []
  const usedNames = new Set<string>()
  const genericCounters = new Map<TokenType, number>()

  const confirmed = rules.filter((r) => r.status === 'confirmed')

  for (const rule of confirmed) {
    const raw = rule.value.trim()
    if (!raw) {
      skipped.push({
        ruleId: rule.id,
        ruleName: rule.name,
        reason: '已确认但值为空，无法生成令牌',
      })
      continue
    }

    const known = KNOWN_MAPPINGS.find((m) => m.names.includes(rule.name)) ?? null
    let type: TokenType
    let value: string

    if (known) {
      const parsed = parseValueAs(known.type, raw)
      if (parsed === null) {
        skipped.push({
          ruleId: rule.id,
          ruleName: rule.name,
          reason: `值「${raw}」无法转换为${TOKEN_TYPE_LABELS[known.type]}令牌（${hintFor(known.type)}）`,
        })
        continue
      }
      type = known.type
      value = parsed
    } else {
      const inferred = inferFromName(rule.name, raw)
      if (!inferred) {
        skipped.push({
          ruleId: rule.id,
          ruleName: rule.name,
          reason: `值「${raw}」无法解析为可用的令牌类型（颜色 / 间距 / 圆角 / 阴影 / 字体 / 边框），请填写具体值`,
        })
        continue
      }
      type = inferred.type
      value = inferred.value
    }

    let name = known?.token ?? null
    if (!name) {
      const next = (genericCounters.get(type) ?? 0) + 1
      genericCounters.set(type, next)
      name = `${type}-custom-${next}`
    }

    const base = name
    let candidate = base
    let suffix = 2
    while (usedNames.has(candidate)) {
      candidate = `${base}-${suffix++}`
    }
    if (candidate !== base) {
      warnings.push(`规则「${rule.name}」的目标令牌名 ${base} 已被占用，已改名为 ${candidate}`)
    }
    usedNames.add(candidate)

    tokens.push({
      name: candidate,
      cssVar: `--${candidate}`,
      value,
      type,
      description: rule.name,
      ruleId: rule.id,
      ruleName: rule.name,
      ruleSource: rule.source,
    })
  }

  return {
    tokens,
    skipped,
    warnings,
    css: buildCss(tokens),
    json: buildJson(tokens, skipped, warnings),
  }
}
