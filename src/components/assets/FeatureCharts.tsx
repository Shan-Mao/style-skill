import type { ColorSwatch, SpatialStats } from '../../lib/imageFeatures'

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`

export function ColorDistribution({ colors, remainder }: { colors: ColorSwatch[]; remainder: number }) {
  if (colors.length === 0) {
    return <p className="feature-empty">图片中没有可统计的不透明像素。</p>
  }
  const showRemainder = remainder > 0.005
  return (
    <div>
      <div className="color-bar" role="img" aria-label="主要颜色占比条">
        {colors.map((c, i) => (
          <span
            key={`${c.hex}-${i}`}
            style={{ background: c.hex, flexGrow: Math.max(c.ratio, 0.004) }}
            title={`${c.hex} ${pct(c.ratio)}`}
          />
        ))}
        {showRemainder && (
          <span className="color-rest" style={{ flexGrow: remainder }} title={`其他颜色合计 ${pct(remainder)}`} />
        )}
      </div>
      <ul className="color-legend">
        {colors.map((c, i) => (
          <li key={`${c.hex}-${i}`}>
            <span className="swatch" style={{ background: c.hex }} />
            <code>{c.hex}</code>
            <span>{pct(c.ratio)}</span>
          </li>
        ))}
        {showRemainder && (
          <li>
            <span className="swatch color-rest" />
            <span>其他颜色</span>
            <span>{pct(remainder)}</span>
          </li>
        )}
      </ul>
    </div>
  )
}

export function LuminanceDistribution({
  histogram,
  mean,
  std,
}: {
  histogram: number[]
  mean: number
  std: number
}) {
  const max = Math.max(...histogram, 1)
  const meanX = ((Math.max(0, Math.min(255, mean)) / 255) * 160).toFixed(1)
  return (
    <div className="luminance-chart">
      <svg
        className="histogram"
        viewBox="0 0 160 48"
        role="img"
        aria-label={`亮度直方图，共 16 档，平均亮度 ${Math.round(mean)}（0–255）`}
      >
        {histogram.map((count, i) => {
          const barHeight = Math.round((count / max) * 44)
          return barHeight > 0 ? (
            <rect key={i} x={i * 10 + 1} y={48 - barHeight} width={8} height={barHeight} className="hist-bar" />
          ) : null
        })}
        <line className="hist-mean" x1={meanX} x2={meanX} y1={0} y2={48} />
      </svg>
      <div className="hist-axis">
        <span>0（暗）</span>
        <span>平均 {Math.round(mean)}</span>
        <span>255（亮）</span>
      </div>
      <p className="metric-caption">
        明暗对比（亮度标准差）：{Math.round(std)}，数值越大代表明暗差异越强
      </p>
    </div>
  )
}

export function EdgeDensityStat({ density }: { density: number }) {
  return (
    <div>
      <p className="feature-stat">
        边缘像素占比<strong>{pct(density)}</strong>
      </p>
      <div className="stat-track" aria-hidden="true">
        <span className="stat-fill" style={{ width: `${Math.min(100, density * 100)}%` }} />
      </div>
    </div>
  )
}

const ORIENTATION_LABELS = ['0–30°', '30–60°', '60–90°', '90–120°', '120–150°', '150–180°']

export function OrientationDistribution({ bins }: { bins: number[] }) {
  if (!bins.some((v) => v > 0)) {
    return <p className="feature-empty">没有检测到达到阈值的边缘。</p>
  }
  return (
    <ul className="orient-bars">
      {bins.map((v, i) => (
        <li key={i}>
          <span className="orient-label">{ORIENTATION_LABELS[i]}</span>
          <span className="orient-track">
            <span className="orient-fill" style={{ width: `${v * 100}%` }} />
          </span>
          <span className="orient-value">{pct(v, 0)}</span>
        </li>
      ))}
    </ul>
  )
}

export function SpatialDistribution({ grid, aspect }: { grid: SpatialStats; aspect: number }) {
  const maxEdge = Math.max(...grid.edgeDensity.filter(Number.isFinite), 0.0001)
  return (
    <div>
      <div className="spatial-grids">
        <figure>
          <figcaption>平均亮度</figcaption>
          <div className="spatial-grid" style={{ aspectRatio: `${aspect}` }}>
            {grid.luminance.map((v, i) =>
              Number.isFinite(v) ? (
                <span
                  key={i}
                  style={{ background: `rgb(${Math.round(v)}, ${Math.round(v)}, ${Math.round(v)})` }}
                  title={`平均亮度 ${Math.round(v)} / 255`}
                />
              ) : (
                <span key={i} className="no-data-cell" title="该格没有采样像素" />
              ),
            )}
          </div>
        </figure>
        <figure>
          <figcaption>边缘密度</figcaption>
          <div className="spatial-grid" style={{ aspectRatio: `${aspect}` }}>
            {grid.edgeDensity.map((v, i) =>
              Number.isFinite(v) ? (
                <span
                  key={i}
                  className="edge-cell"
                  style={{ opacity: v / maxEdge }}
                  title={`边缘密度 ${pct(v)}`}
                />
              ) : (
                <span key={i} className="no-data-cell" title="该格没有采样像素" />
              ),
            )}
          </div>
        </figure>
      </div>
      <p className="metric-caption">
        网格从左到右对应页面左侧→右侧，从上到下对应顶部→底部；悬停单元格查看数值。
      </p>
    </div>
  )
}
