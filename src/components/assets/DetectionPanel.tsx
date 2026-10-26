import type { DetectionState } from '../../lib/detectionClient'
import type { ImportedImage } from '../../lib/imageImport'
import type { DetectionSuccess } from '../../lib/detectionClient'

type DetectionPanelProps = {
  image: ImportedImage
  detection?: DetectionState
  onRun: (image: ImportedImage) => void
}

/** 单图分析中的结构识别面板：与统计特征分离，结果仅作证据展示 */
export function DetectionPanel({ image, detection, onRun }: DetectionPanelProps) {
  const state: DetectionState = detection ?? { status: 'idle' }

  return (
    <section className="feature-block" aria-label="结构识别">
      <h3>结构识别（ScreenParser · 本地模型）</h3>
      {state.status === 'idle' && (
        <div>
          <p className="detection-hint">
            使用本地 ScreenParser 模型识别 UI 元素（55 类：按钮、输入框、导航、链接等），
            与上方的统计特征相互独立。检测结果仅作为证据，不会自动写入设计规则。
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onRun(image)}>
            运行结构识别
          </button>
        </div>
      )}
      {state.status === 'running' && (
        <p className="detection-hint">
          检测中…（本地 CPU 推理约需数秒）
          {state.result ? '上次结果将在完成后更新。' : ''}
        </p>
      )}
      {(state.status === 'unavailable' || state.status === 'error') && (
        <div>
          <p className="feature-warn">
            {state.status === 'unavailable' ? '识别服务不可用' : '识别失败'}：{state.message}
          </p>
          {state.status === 'unavailable' && (
            <p className="detection-hint">
              开发模式请先在项目目录运行 <code>npm run detect:server</code>，再点击重试。
              不运行识别服务不影响其他分析功能。
            </p>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onRun(image)}>
            重试
          </button>
          {state.result && (
            <div className="stale-result">
              <p className="detection-hint">
                以下为该图最近一次成功的检测结果（{state.result.detections.length} 个元素），
                <strong>可能不是最新</strong>：
              </p>
              <DetectionResultView image={image} result={state.result} />
            </div>
          )}
        </div>
      )}
      {state.status === 'done' && state.result && (
        <DetectionResultView
          image={image}
          result={state.result}
          onRerun={() => onRun(image)}
        />
      )}
    </section>
  )
}

function DetectionResultView({
  image,
  result,
  onRerun,
}: {
  image: ImportedImage
  result: DetectionSuccess
  onRerun?: () => void
}) {
  const { detections, imageSize, stats } = result
  const counts = new Map<string, number>()
  for (const d of detections) counts.set(d.label, (counts.get(d.label) ?? 0) + 1)
  const sortedCounts = [...counts.entries()].sort((a, b) => b[1] - a[1])

  return (
    <div>
      <p className="detection-summary">
        检测到 {detections.length} 个元素 · 推理耗时 {stats.inferenceSeconds}s ·
        置信度阈值 {stats.conf}
      </p>
      {detections.length === 0 ? (
        <p className="detection-hint">未检测到任何 UI 元素（图片内容可能过于简单或置信度不足）。</p>
      ) : (
        <div className="detection-chips" aria-label="检测类别统计">
          {sortedCounts.map(([label, n]) => (
            <span key={label} className="det-chip">
              {label} ×{n}
            </span>
          ))}
        </div>
      )}
      <div className="detection-overlay">
        <img src={image.previewUrl} alt={`${image.fileName} 检测框叠加视图`} />
        {detections.map((d, i) => {
          const b = d.bbox
          return (
            <span
              key={i}
              className="det-box"
              style={{
                left: `${(b.x / imageSize.width) * 100}%`,
                top: `${(b.y / imageSize.height) * 100}%`,
                width: `${(b.width / imageSize.width) * 100}%`,
                height: `${(b.height / imageSize.height) * 100}%`,
              }}
              title={`${d.label} · 置信度 ${(d.confidence * 100).toFixed(0)}% · 位置 x=${Math.round(b.x)}, y=${Math.round(b.y)}, ${Math.round(b.width)}×${Math.round(b.height)}`}
            />
          )
        })}
      </div>
      <p className="feature-note">
        <strong>说明：</strong>
        以上为本地 YOLO 模型的客观检测结果，作为证据参考；悬停检测框查看类别、置信度与坐标。
        组件类设计规则仍需在设计规则编辑器中人工确认。
      </p>
      {onRerun && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRerun}>
          重新检测
        </button>
      )}
    </div>
  )
}
