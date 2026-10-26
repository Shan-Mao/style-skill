import { useState } from 'react'
import type { DesignRule } from '../../lib/designRules'
import { CATEGORY_LABELS } from '../../lib/designRules'
import type { DesignToken } from '../../lib/designTokens'
import { TOKEN_TYPE_LABELS, TOKEN_TYPE_ORDER } from '../../lib/designTokens'
import { buildSkillPackage, SKILL_ROOT, zipEntriesOf } from '../../lib/skillPackage'
import type { SkillFile } from '../../lib/skillPackage'
import { buildZipBlob } from '../../lib/zip'
import './skill.css'

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

function downloadText(content: string, fileName: string, mime: string) {
  downloadBlob(new Blob([content], { type: mime }), fileName)
}

export function SkillExportView({
  rules,
  onGoToRules,
}: {
  rules: DesignRule[]
  onGoToRules: () => void
}) {
  const pkg = buildSkillPackage(rules)
  const [selectedPath, setSelectedPath] = useState(`${SKILL_ROOT}/SKILL.md`)
  const selected: SkillFile | undefined =
    pkg.files.find((f) => f.path === selectedPath) ?? pkg.files[0]

  const confirmedCount = rules.filter((r) => r.status === 'confirmed').length
  const pendingCount = rules.filter((r) => r.status === 'pending').length

  const downloadZip = () => {
    downloadBlob(buildZipBlob(zipEntriesOf(pkg)), `${SKILL_ROOT}.zip`)
  }

  // 文件树按目录分组
  const groups: { dir: string; files: SkillFile[] }[] = []
  for (const file of pkg.files) {
    const dir = file.path.slice(0, file.path.lastIndexOf('/') + 1)
    const existing = groups.find((g) => g.dir === dir)
    if (existing) existing.files.push(file)
    else groups.push({ dir, files: [file] })
  }

  return (
    <>
      <header className="workspace-header">
        <div>
          <h1>Skill 生成</h1>
          <p className="workspace-desc">
            把已确认的设计规则打包为标准 Agent Skill（SKILL.md + 设计令牌 + 参考文档），
            全部在本地生成。
          </p>
        </div>
        <div className="rules-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={downloadZip}
            disabled={confirmedCount === 0}
          >
            下载 ZIP
          </button>
        </div>
      </header>

      {confirmedCount === 0 ? (
        <section className="empty-state" aria-labelledby="skill-empty-heading">
          <p className="workspace-eyebrow">Agent Skill</p>
          <h2 id="skill-empty-heading">还没有可生成的 Skill</h2>
          <p className="empty-desc">
            Skill 包只包含「已确认且有值」的设计规则。当前还没有已确认的规则，
            请先在设计规则编辑器中确认规则。
          </p>
          <button type="button" className="btn btn-primary" onClick={onGoToRules}>
            前往设计规则
          </button>
          <p className="empty-note">
            待确认、已忽略或空值的规则不会进入正式约束；不会用示例规则填充导出内容。
          </p>
        </section>
      ) : (
        <>
          <p className="tokens-summary">
            {pkg.files.length} 个文件 · {pkg.tokenResult.tokens.length} 个令牌 ·{' '}
            {pkg.confirmedRules.length} 条已确认规则形成正式约束
            {pendingCount > 0 ? ` · 另有 ${pendingCount} 条待确认规则未纳入` : ''}
          </p>

          {pkg.missingCategories.length > 0 && (
            <div className="warning-note" role="alert">
              以下设计类别缺少已确认规范：
              {pkg.missingCategories.map((c) => CATEGORY_LABELS[c]).join('、')}。
              生成内容中这些类别会明确标注「未提供已确认规范」，不会虚构约束。
            </div>
          )}

          {TOKEN_TYPE_ORDER.map((type) => {
            const group = pkg.tokenResult.tokens.filter((t) => t.type === type)
            if (group.length === 0) return null
            return (
              <section key={type} className="token-group" aria-label={TOKEN_TYPE_LABELS[type]}>
                <h2 className="section-title">
                  {TOKEN_TYPE_LABELS[type]}令牌
                  <span className="rule-count">{group.length}</span>
                </h2>
                <ul className="rule-list">
                  {group.map((token) => (
                    <TokenRow key={token.ruleId} token={token} />
                  ))}
                </ul>
              </section>
            )
          })}

          {pkg.tokenResult.warnings.length > 0 && (
            <div className="warning-note">
              {pkg.tokenResult.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
          )}

          {pkg.tokenResult.skipped.length > 0 && (
            <section className="token-group" aria-label="未能生成令牌的规则">
              <h2 className="section-title">
                未能生成令牌的已确认规则
                <span className="rule-count">{pkg.tokenResult.skipped.length}</span>
              </h2>
              {pkg.tokenResult.skipped.map((s) => (
                <p key={s.ruleId} className="skipped-item">
                  <strong>{s.ruleName}</strong>：{s.reason}
                </p>
              ))}
            </section>
          )}

          <section className="token-group" aria-label="文件预览">
            <h2 className="section-title">
              文件预览
              <span className="rule-count">{pkg.files.length} 个文件</span>
            </h2>
            <div className="file-browser">
              <ul className="file-tree" aria-label="文件树">
                {groups.map((group) => (
                  <li key={group.dir}>
                    <p className="file-dir-label">{group.dir}</p>
                    <ul>
                      {group.files.map((file) => {
                        const name = file.path.slice(file.path.lastIndexOf('/') + 1)
                        const active = selected?.path === file.path
                        return (
                          <li key={file.path}>
                            <button
                              type="button"
                              className={active ? 'file-item is-active' : 'file-item'}
                              aria-current={active ? 'true' : undefined}
                              onClick={() => setSelectedPath(file.path)}
                            >
                              {name}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
              {selected && (
                <div className="file-view">
                  <FileViewHead file={selected} />
                  <pre className="code-block">{selected.content}</pre>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </>
  )
}

function TokenRow({ token }: { token: DesignToken }) {
  return (
    <li className="token-row">
      <code className="token-var">{token.cssVar}</code>
      <span className="token-desc">{token.description}</span>
      <span className="token-value">
        {token.type === 'color' && (
          <span className="color-dot" style={{ background: token.value }} />
        )}
        {token.value}
      </span>
    </li>
  )
}

function FileViewHead({ file }: { file: SkillFile }) {
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const fileName = file.path.slice(file.path.lastIndexOf('/') + 1)

  const handleCopy = async () => {
    const ok = await copyText(file.content)
    setCopyState(ok ? 'ok' : 'fail')
    setTimeout(() => setCopyState('idle'), 1600)
  }

  return (
    <div className="output-head">
      <h3 className="file-path">{file.path}</h3>
      <div className="output-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={handleCopy}>
          {copyState === 'ok' ? '已复制' : copyState === 'fail' ? '复制失败' : '复制'}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() =>
            downloadText(
              file.content,
              fileName,
              file.lang === 'json' ? 'application/json' : 'text/plain',
            )
          }
        >
          下载此文件
        </button>
      </div>
    </div>
  )
}
