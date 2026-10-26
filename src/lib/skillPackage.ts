/**
 * Agent Skill 文件包生成：把已确认的设计规则打包为标准 Skill 目录
 * style-skill/（SKILL.md + assets/tokens.* + references/*.md）。
 *
 * 原则：
 * - 只有「已确认且有值」的规则构成正式设计约束；
 * - 待确认 / 已忽略 / 空值规则只出现在"尚未确认"清单并标注非强制；
 * - 缺少已确认规范的类别明确写"未提供已确认规范"，不虚构内容；
 * - tokens.css / tokens.json 直接复用 designTokens.buildTokens。
 */

import type { DesignRule, RuleCategory } from './designRules'
import { CATEGORY_LABELS, CATEGORY_ORDER, SOURCE_LABELS } from './designRules'
import { buildTokens } from './designTokens'
import type { TokenResult } from './designTokens'

export const SKILL_ROOT = 'style-skill'

export type SkillFile = {
  path: string
  content: string
  lang: 'markdown' | 'css' | 'json'
}

export type SkillPackage = {
  files: SkillFile[]
  tokenResult: TokenResult
  /** 已确认且有值（正式约束） */
  confirmedRules: DesignRule[]
  /** 待确认 / 已忽略 / 已确认但空值（非强制） */
  unconfirmedRules: DesignRule[]
  /** 没有任何正式约束的设计类别 */
  missingCategories: RuleCategory[]
}

/** 压缩为单行，避免用户输入的换行破坏 Markdown 列表 */
const inline = (s: string) => s.replace(/\s+/g, ' ').trim()

function statusLabelOf(rule: DesignRule): string {
  if (rule.status === 'pending') return '待确认'
  if (rule.status === 'ignored') return '已忽略'
  return '已确认但未填写值'
}

function confirmedOf(rules: DesignRule[], cat: RuleCategory): DesignRule[] {
  return rules.filter((r) => r.category === cat)
}

function categoryBullets(confirmed: DesignRule[]): string[] {
  if (confirmed.length === 0) {
    return ['- 未提供已确认规范。']
  }
  return confirmed.map(
    (r) => `- **${inline(r.name)}**：「${inline(r.value)}」（来源：${SOURCE_LABELS[r.source]}）`,
  )
}

function buildSkillMd(
  confirmed: DesignRule[],
  unconfirmed: DesignRule[],
  tokens: TokenResult,
  missing: RuleCategory[],
): string {
  const catSummary = CATEGORY_ORDER.filter((cat) => confirmedOf(confirmed, cat).length > 0)
    .map((cat) => `${CATEGORY_LABELS[cat]} ${confirmedOf(confirmed, cat).length} 条`)
    .join('、')
  const description =
    `基于 ${confirmed.length} 条已确认设计规则（${catSummary}）生成的 UI 视觉设计规范，` +
    `含 ${tokens.tokens.length} 个设计令牌、实施流程、视觉约束与验收标准，` +
    `用于开发与参考截图视觉语言一致的 Web 界面。`.replace(/:/g, '：')

  const lines: string[] = []
  lines.push('---')
  lines.push(`name: ${SKILL_ROOT}`)
  lines.push(`description: ${description}`)
  lines.push('---', '')
  lines.push('# UI 视觉设计规范（Style Skill）', '')
  lines.push(
    '本规范由 Style Skill 从参考截图分析与用户确认的设计规则生成。' +
      '只有「已确认且有值」的规则是正式设计约束；标注「待确认」「已忽略」「推断」的内容不是事实，使用前需向用户确认。',
    '',
  )

  lines.push('## 适用场景', '')
  lines.push('- 依据参考截图的视觉风格开发或重构 Web 界面（新页面、新组件、样式调整）。')
  lines.push('- 在同一产品内延续既有视觉语言的功能迭代。')
  lines.push('- 对界面实现做视觉走查与样式修正。')
  lines.push('- 不适用于全新的品牌或视觉方向设计。', '')

  lines.push('## 设计原则', '')
  for (const cat of CATEGORY_ORDER) {
    lines.push(`### ${CATEGORY_LABELS[cat]}`, '')
    lines.push(...categoryBullets(confirmedOf(confirmed, cat)))
    lines.push('')
  }

  lines.push('## 实施流程', '')
  lines.push('1. 先阅读 `assets/tokens.json`，了解全部设计令牌、值与来源规则。')
  lines.push('2. 将 `assets/tokens.css` 引入项目（`:root` CSS 自定义属性），或映射到项目现有的样式变量方案。')
  lines.push('3. 颜色、间距等一律使用令牌（如 `var(--color-primary)`），不要硬编码近似值。')
  lines.push('4. 逐条对照 `references/design-rules.md` 中的已确认规则；组件实现参考 `references/component-guidelines.md`。')
  lines.push('5. 完成后按 `references/verification-checklist.md` 逐项自检并修复问题。', '')

  lines.push('## 视觉约束', '')
  lines.push('必须遵守：')
  for (const cat of CATEGORY_ORDER) {
    for (const r of confirmedOf(confirmed, cat)) {
      lines.push(`- ${CATEGORY_LABELS[cat]} · ${inline(r.name)}：${inline(r.value)}`)
    }
  }
  lines.push('')
  lines.push('允许调整：')
  lines.push('- 未列入已确认规则的视觉细节可在合理范围内调整，但不得与上述约束冲突。')
  lines.push('')
  lines.push('尚未确认（不是强制约束，使用前需用户确认）：')
  if (unconfirmed.length === 0) {
    lines.push('- 无——当前所有规则均已确认。')
  } else {
    for (const r of unconfirmed) {
      lines.push(`- ${CATEGORY_LABELS[r.category]} · ${inline(r.name)}（${statusLabelOf(r)}）`)
    }
  }
  lines.push('')
  if (missing.length > 0) {
    lines.push('缺少已确认规范的类别：')
    for (const cat of missing) {
      lines.push(`- ${CATEGORY_LABELS[cat]}：未提供已确认规范。`)
    }
    lines.push('')
  }

  lines.push('## 禁止事项', '')
  lines.push('- 不得更改已确认的令牌值（主色、背景色等），不得引入与令牌冲突的近似色。')
  lines.push('- 不得把本规范中标注「待确认」「已忽略」「推断」的内容当作用户已确认的事实。')
  lines.push('- 不得无依据地添加渐变、阴影、圆角、装饰性图标等效果；组件属性未确认时保持中性实现。')
  lines.push('- 不得跳过 `references/verification-checklist.md` 的验收自检。', '')

  lines.push('## 验收标准', '')
  lines.push('逐项检查，全部通过才算符合本规范（明细见 `references/verification-checklist.md`）：')
  const colorVars = tokens.tokens.filter((t) => t.type === 'color').map((t) => t.cssVar)
  if (colorVars.length > 0) {
    lines.push(`- 颜色：关键颜色均来自 \`assets/tokens.css\`（${colorVars.slice(0, 5).join('、')}${colorVars.length > 5 ? ' 等' : ''}）。`)
  } else {
    lines.push('- 颜色：未提供已确认规范——不得引入与参考截图冲突的新颜色。')
  }
  const layoutRules = confirmed.filter((r) => r.category === 'layout' || r.category === 'hierarchy')
  lines.push(
    layoutRules.length > 0
      ? `- 布局与层级：符合已确认规则（${layoutRules.map((r) => inline(r.name)).join('、')}）。`
      : '- 布局与层级：未提供已确认规范——保持与参考截图一致的通用布局。',
  )
  const componentRules = confirmed.filter((r) => r.category === 'component')
  lines.push(
    componentRules.length > 0
      ? `- 组件一致性：已确认组件规则（${componentRules.map((r) => inline(r.name)).join('、')}）全部执行。`
      : '- 组件一致性：组件属性未提供已确认规范，未擅自添加装饰。',
  )
  lines.push('- 响应式：约 420px 窄屏下无横向溢出、布局可用。')
  lines.push('- 实际效果：真实浏览器中与参考截图的视觉语言（明暗、密度、色彩）一致。')
  lines.push('')
  return lines.join('\n')
}

function buildDesignRulesMd(
  confirmed: DesignRule[],
  unconfirmed: DesignRule[],
  tokens: TokenResult,
): string {
  const lines: string[] = []
  lines.push('# 设计规则明细', '')
  lines.push('> 本文件记录 Skill 包内全部规则的来源与状态。只有「已确认且有值」的规则是正式设计约束。', '')

  lines.push(`## 已确认规则（${confirmed.length} 条）`, '')
  if (confirmed.length === 0) {
    lines.push('- 无。')
  }
  for (const cat of CATEGORY_ORDER) {
    const rules = confirmedOf(confirmed, cat)
    if (rules.length === 0) continue
    lines.push(`### ${CATEGORY_LABELS[cat]}`, '')
    for (const r of rules) {
      lines.push(`- **${inline(r.name)}**：「${inline(r.value)}」`)
      const images = r.sourceImages.map((i) => i.name).join('、')
      lines.push(
        `  - 来源：${SOURCE_LABELS[r.source]}（用户已确认） · 证据：${inline(r.evidence)}${images ? ` · 关联图片：${images}` : ''}`,
      )
    }
    lines.push('')
  }

  if (tokens.skipped.length > 0) {
    lines.push(`## 已确认但未形成令牌的规则（${tokens.skipped.length} 条）`, '')
    for (const s of tokens.skipped) {
      lines.push(`- **${inline(s.ruleName)}**：${inline(s.reason)}`)
    }
    lines.push('')
  }

  lines.push(`## 尚未确认的规则（非强制约束，共 ${unconfirmed.length} 条）`, '')
  if (unconfirmed.length === 0) {
    lines.push('- 无——当前所有规则均已确认。')
  }
  for (const r of unconfirmed) {
    lines.push(`- ${CATEGORY_LABELS[r.category]} · ${inline(r.name)} —— ${statusLabelOf(r)}`)
  }
  lines.push('')

  lines.push('## 状态说明', '')
  lines.push('- 来源「实测」：值来自本地图像计算的直接测量；「推断」：基于阈值的解读，建议人工复核；「手动」：用户填写。')
  lines.push('- 规则状态（待确认 / 已确认 / 已忽略）由用户在 Style Skill 的设计规则编辑器中维护。')
  lines.push('')
  return lines.join('\n')
}

function buildComponentGuidelinesMd(confirmed: DesignRule[], tokens: TokenResult): string {
  const lines: string[] = []
  lines.push('# 组件实现指导', '')
  lines.push('> 仅基于已确认规则；未确认属性标注「待确认」，实现时保持中性、不过度设计。', '')

  lines.push('## 通用规则', '')
  const colorTokens = tokens.tokens.filter((t) => t.type === 'color')
  if (colorTokens.length > 0) {
    lines.push('- 组件使用的颜色一律来自 `../assets/tokens.css`，不要硬编码。')
    const primary = tokens.tokens.find((t) => t.name === 'color-primary')
    if (primary) lines.push(`- 主操作 / 强调场景建议使用 \`${primary.cssVar}\`（已确认主色 ${primary.value}）。`)
    const text = tokens.tokens.find((t) => t.name === 'color-text')
    if (text) lines.push(`- 正文文字建议使用 \`${text.cssVar}\`（已确认 ${text.value}）。`)
  } else {
    lines.push('- 颜色：未提供已确认规范——组件用色保持中性（黑白灰阶），不引入彩色。')
  }
  lines.push('')

  lines.push('## 组件属性状态', '')
  const componentNames = ['圆角风格', '边框与描边', '阴影与投影', '按钮样式', '输入框样式', '导航样式', '卡片样式']
  for (const name of componentNames) {
    const rule = confirmed.find((r) => r.name === name)
    lines.push(`### ${name}`)
    if (rule) {
      lines.push(`- 已确认：「${inline(rule.value)}」——按此执行，全组件保持一致。`)
    } else {
      lines.push('- 待确认：未提供已确认规范。默认保持浏览器原生样式 / 最小化处理，不要添加装饰性取值。')
    }
    lines.push('')
  }
  return lines.join('\n')
}

function buildChecklistMd(confirmed: DesignRule[], tokens: TokenResult): string {
  const lines: string[] = []
  lines.push('# 视觉验收清单', '')
  lines.push('> 逐项检查；任何一项不通过都需修复后复检。检查时同时打开参考截图对照。', '')

  lines.push('## 颜色', '')
  const colorTokens = tokens.tokens.filter((t) => t.type === 'color')
  if (colorTokens.length === 0) {
    lines.push('- [ ] 未提供已确认颜色规范——未引入与参考截图冲突的新颜色')
  }
  for (const t of colorTokens) {
    lines.push(`- [ ] ${t.description}使用 \`${t.cssVar}\`（已确认：${t.value}）`)
  }
  lines.push('- [ ] 未使用令牌之外的硬编码颜色')
  lines.push('')

  lines.push('## 间距与尺寸', '')
  const dimTokens = tokens.tokens.filter((t) => t.type === 'spacing' || t.type === 'radius')
  if (dimTokens.length === 0) {
    lines.push('- 未提供已确认规范（无间距 / 圆角令牌）。')
  }
  for (const t of dimTokens) {
    lines.push(`- [ ] ${t.description}遵循 \`${t.cssVar}\`（已确认：${t.value}）`)
  }
  lines.push('')

  lines.push('## 布局与层级', '')
  const layoutRules = confirmed.filter((r) => r.category === 'layout' || r.category === 'hierarchy')
  if (layoutRules.length === 0) {
    lines.push('- 未提供已确认规范——布局与参考截图保持一致的通用结构。')
  }
  for (const r of layoutRules) {
    lines.push(`- [ ] 「${inline(r.name)}」：${inline(r.value)} —— 与参考截图对照`)
  }
  lines.push('')

  lines.push('## 组件', '')
  const componentRules = confirmed.filter((r) => r.category === 'component')
  if (componentRules.length > 0) {
    for (const r of componentRules) {
      lines.push(`- [ ] ${inline(r.name)}按已确认值「${inline(r.value)}」执行且全组件一致`)
    }
  } else {
    lines.push('- 未提供已确认组件规范。')
  }
  lines.push('- [ ] 未确认的组件属性未添加未经确认的装饰（阴影 / 圆角 / 描边）')
  lines.push('')

  lines.push('## 响应式', '')
  lines.push('- [ ] 约 420px 窄屏下无横向滚动、文字可读、布局可用')
  lines.push('- [ ] 设计令牌在窄屏下未被覆盖')
  lines.push('')

  lines.push('## 整体效果', '')
  lines.push('- [ ] 与参考截图并排对比：明暗基调、视觉密度、色彩倾向一致')
  lines.push('')
  return lines.join('\n')
}

export function buildSkillPackage(rules: DesignRule[]): SkillPackage {
  const tokenResult = buildTokens(rules)
  const confirmedRules = rules.filter((r) => r.status === 'confirmed' && r.value.trim().length > 0)
  const unconfirmedRules = rules.filter((r) => r.status !== 'confirmed' || r.value.trim().length === 0)
  const missingCategories = CATEGORY_ORDER.filter(
    (cat) => !confirmedRules.some((r) => r.category === cat),
  )

  const files: SkillFile[] = [
    {
      path: `${SKILL_ROOT}/SKILL.md`,
      content: buildSkillMd(confirmedRules, unconfirmedRules, tokenResult, missingCategories),
      lang: 'markdown',
    },
    { path: `${SKILL_ROOT}/assets/tokens.css`, content: tokenResult.css, lang: 'css' },
    { path: `${SKILL_ROOT}/assets/tokens.json`, content: tokenResult.json, lang: 'json' },
    {
      path: `${SKILL_ROOT}/references/design-rules.md`,
      content: buildDesignRulesMd(confirmedRules, unconfirmedRules, tokenResult),
      lang: 'markdown',
    },
    {
      path: `${SKILL_ROOT}/references/component-guidelines.md`,
      content: buildComponentGuidelinesMd(confirmedRules, tokenResult),
      lang: 'markdown',
    },
    {
      path: `${SKILL_ROOT}/references/verification-checklist.md`,
      content: buildChecklistMd(confirmedRules, tokenResult),
      lang: 'markdown',
    },
  ]

  return { files, tokenResult, confirmedRules, unconfirmedRules, missingCategories }
}

/** 组装 ZIP 条目：目录条目 + 文件条目（相对路径，根目录为 style-skill/） */
export function zipEntriesOf(pkg: SkillPackage): { path: string; content?: string }[] {
  return [
    { path: `${SKILL_ROOT}/` },
    { path: `${SKILL_ROOT}/assets/` },
    { path: `${SKILL_ROOT}/references/` },
    ...pkg.files.map((f) => ({ path: f.path, content: f.content })),
  ]
}
