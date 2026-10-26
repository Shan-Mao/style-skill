import { useState } from 'react'
import type { RuleCategory, RuleStatus } from '../../lib/designRules'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  colorCandidates,
  isColorValue,
  SOURCE_LABELS,
  STATUS_LABELS,
  structureRuleCandidates,
} from '../../lib/designRules'
import type { ColorCandidate, DesignRule } from '../../lib/designRules'
import type { ImportedImage } from '../../lib/imageImport'
import type { DetectionStateMap } from '../../lib/detectionClient'
import './editor.css'

type RulesEditorProps = {
  rules: DesignRule[]
  images: ImportedImage[]
  detections: DetectionStateMap
  onReinit: () => void
  onUpdate: (id: string, patch: { value?: string; status?: RuleStatus }) => void
  onAdd: (rule: { category: RuleCategory; name: string; value: string }) => void
  onRemove: (id: string) => void
  onShowImage: (imageId: string) => void
  onGoToAssets: () => void
}

type StatusFilter = 'all' | RuleStatus

export function RulesEditor({
  rules,
  images,
  detections,
  onReinit,
  onUpdate,
  onAdd,
  onRemove,
  onShowImage,
  onGoToAssets,
}: RulesEditorProps) {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const imageIds = new Set(images.map((i) => i.id))
  const candidates = colorCandidates(images)
  const statusCounts: Record<RuleStatus, number> = { pending: 0, confirmed: 0, ignored: 0 }
  for (const r of rules) statusCounts[r.status] += 1

  // 新的结构证据：候选规则名尚未出现在现有规则中（用户重新生成后纳入）
  const knownNames = new Set(rules.map((r) => r.name))
  const newEvidence = structureRuleCandidates(images, detections)
    .map((r) => r.name)
    .filter((name) => !knownNames.has(name))

  const visible = filter === 'all' ? rules : rules.filter((r) => r.status === filter)

  return (
    <>
      <header className="workspace-header">
        <div>
          <h1>设计规则</h1>
          <p className="workspace-desc">
            把分析结果转化为可审阅的设计规范：确认、修改或忽略每条建议；无法自动检测的属性可人工补充。
            已确认的规则将作为后续生成 Agent Skill 的依据。
          </p>
        </div>
        <div className="rules-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onReinit}
            disabled={images.length === 0}
          >
            从分析重新生成
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setAdding((a) => !a)}>
            手动新增规则
          </button>
        </div>
      </header>

      {adding && <ManualRuleForm onAdd={onAdd} onClose={() => setAdding(false)} />}

      {images.length === 0 && rules.length === 0 ? (
        <section className="empty-state" aria-labelledby="rules-empty-heading">
          <p className="workspace-eyebrow">设计规则</p>
          <h2 id="rules-empty-heading">还没有设计规则</h2>
          <p className="empty-desc">
            导入参考图后，会自动从颜色、明度、边缘等分析结果生成待确认的规则建议；也可以直接手动创建。
          </p>
          <button type="button" className="btn btn-primary" onClick={onGoToAssets}>
            前往导入参考图
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setAdding(true)}>
            手动创建规则
          </button>
          <p className="empty-note">当前没有可用的分析结果，不会生成任何推断结论。</p>
        </section>
      ) : (
        <>
          {images.length === 0 && rules.length > 0 && (
            <p className="stats-note">
              当前没有参考图，无法重新生成分析建议；已有规则已保留，可继续手动维护。
            </p>
          )}
          {images.length > 0 && rules.length === 0 && (
            <p className="stats-note">
              规则为空。点击右上角「从分析重新生成」，从当前 {images.length} 张参考图的分析结果创建规则建议。
            </p>
          )}

          {newEvidence.length > 0 && (
            <div className="warning-note" role="status">
              有 {newEvidence.length} 条新的结构证据候选待纳入
              （{newEvidence.slice(0, 2).join('、')}
              {newEvidence.length > 2 ? ' 等' : ''}）。点击「从分析重新生成」纳入；
              已编辑、已确认、已忽略的规则不会被覆盖。
            </div>
          )}

          <div className="rules-meta" role="group" aria-label="按状态筛选">
            <button
              type="button"
              className={filter === 'all' ? 'filter-chip is-active' : 'filter-chip'}
              onClick={() => setFilter('all')}
            >
              全部 {rules.length}
            </button>
            {(['pending', 'confirmed', 'ignored'] as RuleStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                className={filter === s ? 'filter-chip is-active' : 'filter-chip'}
                onClick={() => setFilter(s)}
              >
                {STATUS_LABELS[s]} {statusCounts[s]}
              </button>
            ))}
          </div>

          {CATEGORY_ORDER.map((cat) => {
            const catRules = visible.filter((r) => r.category === cat)
            if (catRules.length === 0) return null
            return (
              <section key={cat} className="rule-category" aria-label={CATEGORY_LABELS[cat]}>
                <h2 className="section-title">
                  {CATEGORY_LABELS[cat]}
                  <span className="rule-count">{catRules.length} 条</span>
                </h2>
                {cat === 'color' && candidates.length > 0 && (
                  <div className="palette-strip" aria-label="候选颜色">
                    {candidates.slice(0, 12).map((c) => (
                      <span
                        key={c.hex}
                        className="palette-swatch"
                        style={{ background: c.hex }}
                        title={`${c.hex} · ${c.imageCount}/${images.length} 张图 · 平均占比 ${(c.avgRatio * 100).toFixed(0)}%`}
                      />
                    ))}
                    <span className="candidates-label">
                      候选颜色（悬停查看占比；编辑颜色类规则时可直接选用）
                    </span>
                  </div>
                )}
                <ul className="rule-list">
                  {catRules.map((rule) => (
                    <RuleRow
                      key={rule.id}
                      rule={rule}
                      editing={editingId === rule.id}
                      candidates={cat === 'color' ? candidates : []}
                      imageIds={imageIds}
                      onToggleEdit={() =>
                        setEditingId((cur) => (cur === rule.id ? null : rule.id))
                      }
                      onUpdate={onUpdate}
                      onRemove={onRemove}
                      onShowImage={onShowImage}
                    />
                  ))}
                </ul>
              </section>
            )
          })}

          {visible.length === 0 && (
            <p className="asset-hint">当前筛选下没有规则，切换筛选或新增规则。</p>
          )}
        </>
      )}
    </>
  )
}

function RuleRow({
  rule,
  editing,
  candidates,
  imageIds,
  onToggleEdit,
  onUpdate,
  onRemove,
  onShowImage,
}: {
  rule: DesignRule
  editing: boolean
  candidates: ColorCandidate[]
  imageIds: Set<string>
  onToggleEdit: () => void
  onUpdate: (id: string, patch: { value?: string; status?: RuleStatus }) => void
  onRemove: (id: string) => void
  onShowImage: (imageId: string) => void
}) {
  const rowClass = `rule-row is-${rule.status}`
  return (
    <li className={rowClass}>
      <div className="rule-main">
        <div className="rule-body">
          <div className="rule-title-line">
            <span className="rule-name">{rule.name}</span>
            <span
              className={
                rule.status === 'confirmed' ? 'rule-tag is-confirmed' : 'rule-tag'
              }
            >
              {STATUS_LABELS[rule.status]}
            </span>
            <span
              className={
                rule.source === 'inferred' ? 'rule-tag is-inferred' : 'rule-tag'
              }
            >
              {SOURCE_LABELS[rule.source]}
            </span>
            {rule.edited && <span className="rule-edited-tag">已编辑</span>}
          </div>
          <div className="rule-value">
            {isColorValue(rule.value) ? (
              <>
                <span className="color-dot" style={{ background: rule.value }} />
                <code>{rule.value}</code>
              </>
            ) : rule.value ? (
              <span>{rule.value}</span>
            ) : (
              <span className="rule-value-empty">未设置（待人工填写或指定）</span>
            )}
          </div>
          <p className="rule-evidence">
            <span>{rule.evidence}</span>
            {rule.sourceImages.map((ref) =>
              imageIds.has(ref.id) ? (
                <button
                  key={ref.id}
                  type="button"
                  className="evidence-chip"
                  title="查看该图片的分析"
                  onClick={() => onShowImage(ref.id)}
                >
                  {ref.name}
                </button>
              ) : (
                <span key={ref.id} className="evidence-chip is-gone" title="该图片已被移除">
                  {ref.name}
                </span>
              ),
            )}
          </p>
        </div>
        <div className="rule-actions">
          {rule.status !== 'ignored' && (
            <button type="button" className="link-btn" onClick={onToggleEdit}>
              {editing ? '收起' : '编辑'}
            </button>
          )}
          {rule.status === 'pending' && (
            <>
              <button
                type="button"
                className="link-btn"
                onClick={() => onUpdate(rule.id, { status: 'confirmed' })}
              >
                确认
              </button>
              <button
                type="button"
                className="link-btn"
                onClick={() => onUpdate(rule.id, { status: 'ignored' })}
              >
                忽略
              </button>
            </>
          )}
          {rule.status === 'confirmed' && (
            <>
              <button
                type="button"
                className="link-btn"
                onClick={() => onUpdate(rule.id, { status: 'pending' })}
              >
                取消确认
              </button>
              <button
                type="button"
                className="link-btn"
                onClick={() => onUpdate(rule.id, { status: 'ignored' })}
              >
                忽略
              </button>
            </>
          )}
          {rule.status === 'ignored' && (
            <button
              type="button"
              className="link-btn"
              onClick={() => onUpdate(rule.id, { status: 'pending' })}
            >
              恢复
            </button>
          )}
          {rule.custom && (
            <button
              type="button"
              className="link-btn danger"
              onClick={() => onRemove(rule.id)}
            >
              删除
            </button>
          )}
        </div>
      </div>
      {editing && (
        <RuleEditPanel
          key={rule.id}
          rule={rule}
          candidates={candidates}
          onSave={(value) => {
            onUpdate(rule.id, { value })
            onToggleEdit()
          }}
          onCancel={onToggleEdit}
        />
      )}
    </li>
  )
}

function RuleEditPanel({
  rule,
  candidates,
  onSave,
  onCancel,
}: {
  rule: DesignRule
  candidates: ColorCandidate[]
  onSave: (value: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(rule.value)
  const validColor = isColorValue(draft)

  return (
    <div className="rule-edit">
      {rule.category === 'color' ? (
        <div className="color-edit">
          <input
            type="color"
            aria-label="选择颜色"
            value={validColor ? draft.toUpperCase() : '#ffffff'}
            onChange={(e) => setDraft(e.target.value.toUpperCase())}
          />
          <input
            className="hex-input"
            value={draft}
            placeholder="#RRGGBB"
            onChange={(e) => setDraft(e.target.value)}
          />
          {candidates.length > 0 && (
            <div className="swatch-candidates">
              <span className="candidates-label">候选：</span>
              {candidates.slice(0, 12).map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  className="cand-swatch"
                  style={{ background: c.hex }}
                  title={`${c.hex} · ${c.imageCount} 张图 · 平均占比 ${(c.avgRatio * 100).toFixed(0)}%`}
                  onClick={() => setDraft(c.hex)}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <textarea
          className="rule-textarea"
          rows={2}
          value={draft}
          placeholder="填写规则内容（可留空待确认）"
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
      <div className="rule-edit-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => onSave(draft.trim())}
        >
          保存
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  )
}

function ManualRuleForm({
  onAdd,
  onClose,
}: {
  onAdd: (rule: { category: RuleCategory; name: string; value: string }) => void
  onClose: () => void
}) {
  const [category, setCategory] = useState<RuleCategory>('color')
  const [name, setName] = useState('')
  const [value, setValue] = useState('')

  const submit = () => {
    if (!name.trim()) return
    onAdd({ category, name: name.trim(), value: value.trim() })
    setName('')
    setValue('')
  }

  return (
    <div className="manual-add">
      <select
        aria-label="规则分类"
        value={category}
        onChange={(e) => setCategory(e.target.value as RuleCategory)}
      >
        {CATEGORY_ORDER.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABELS[c]}
          </option>
        ))}
      </select>
      <input
        className="name-input"
        placeholder="规则名称（如：链接色）"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="value-input"
        placeholder="规则值（颜色填 #RRGGBB，可留空待确认）"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={submit}
        disabled={!name.trim()}
      >
        添加
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
        关闭
      </button>
    </div>
  )
}
