import { matchColorGroups, spatialCrossStats } from '../../lib/crossImage'
import {
  compareImages,
  complexityBand,
  contrastBand,
  luminanceBand,
  UNANALYZED_ITEMS,
} from '../../lib/designLanguage'
import type { ImportedImage } from '../../lib/imageImport'
import { shortFileName } from '../../lib/imageImport'
import type { DetectionStateMap, DetectionSuccess } from '../../lib/detectionClient'
import { compareStructures, extractStructureFeatures } from '../../lib/structureFeatures'
import { DesignReadings } from './DesignReadings'

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`

export function MultiSummary({
  images,
  detections,
}: {
  images: ImportedImage[]
  detections: DetectionStateMap
}) {
  const n = images.length
  const { stable, differences } = compareImages(images)
  const colorGroups = matchColorGroups(images).slice(0, 10)
  const spatial = spatialCrossStats(images)

  // 结构对比：使用有检测结果的图片（含检测失败但保留了旧结果的图，标注区分）；
  // 完全没有结果的图片不纳入，但不阻断其他对比
  const structureEntries = images
    .filter((img) => detections[img.id]?.result)
    .map((img) => ({
      image: img,
      stale: detections[img.id].status !== 'done',
      features: extractStructureFeatures(
        detections[img.id].result as DetectionSuccess,
      ),
    }))
  const staleCount = structureEntries.filter((e) => e.stale).length
  const freshCount = structureEntries.length - staleCount
  const structureMissing = images.filter((img) => !detections[img.id]?.result)
  const structureComparison =
    structureEntries.length > 0
      ? compareStructures(
          structureEntries.map((e) => ({ fileName: e.image.fileName, features: e.features })),
        )
      : null

  const finiteAvg = spatial.avgEdgeDensity.filter(Number.isFinite)
  const maxAvgEdge = Math.max(...finiteAvg, 0.0001)
  const finiteStd = spatial.stdEdgeDensity.filter(Number.isFinite)
  const maxStdEdge = Math.max(...finiteStd, 0.0001)

  const aspects = images.map((i) => i.features.sampleWidth / i.features.sampleHeight)
  const avgAspect = aspects.reduce((a, b) => a + b, 0) / aspects.length

  return (
    <section className="multi-summary" aria-label="多图汇总分析">
      <h2 className="section-title">多图汇总 · {n} 张</h2>
      <p className="stats-note">
        统计口径：每张图片缩放至最长边 ≤512px 后由本地确定性算法计算；颜色占比按各图不透明像素归一化，跨图颜色匹配阈值为
        RGB 距离 ≤40。截图尺寸、背景面积与页面内容都会影响占比——颜色出现次数不等于设计重要性，请结合图片内容判断，不应直接当作设计规范。
      </p>

      <section className="feature-block">
        <h3>设计语言分析</h3>
        <h4 className="reading-group-title">跨图片稳定出现的特征</h4>
        <DesignReadings readings={stable} />
        <h4 className="reading-group-title">明显差异</h4>
        <DesignReadings readings={differences} />
        <p className="feature-note">
          <strong>说明：</strong>
          分档与判定阈值（偏暗/偏亮、简洁/复杂、边缘集中倍数等）为经验规则，用于快速理解数据。
        </p>
        <p className="feature-note">
          <strong>尚未分析：</strong>
          {UNANALYZED_ITEMS.join('、')}
          ——当前确定性指标无法可靠判断，需后续阶段或人工确认。
        </p>
      </section>

      <section className="feature-block">
        <h3>主要颜色的跨图出现情况</h3>
        {colorGroups.length === 0 ? (
          <p className="feature-empty">没有可统计的颜色（图片可能完全透明）。</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>颜色</th>
                  <th>出现</th>
                  {images.map((img) => (
                    <th key={img.id} title={img.fileName}>
                      {shortFileName(img.fileName)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {colorGroups.map((g, i) => (
                  <tr key={i}>
                    <td>
                      <span className="table-swatch" style={{ background: g.hex }} />
                      <code>{g.hex}</code>
                    </td>
                    <td className="nowrap">
                      {g.imageCount}/{n}
                    </td>
                    {images.map((img) => {
                      const entry = g.entries.find((e) => e.fileName === img.fileName)
                      return (
                        <td key={img.id} className="nowrap">
                          {entry ? pct(entry.ratio) : <span className="dim">—</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="feature-note">
          <strong>说明：</strong>
          仅统计各图占比前 6 的主要颜色；单元格为该色在本图中的像素占比，— 表示未进入本图主要颜色。
        </p>
      </section>

      <section className="feature-block">
        <h3>明度与对比度</h3>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>图片</th>
                <th>平均亮度（0–255）</th>
                <th>基调</th>
                <th>对比度（标准差）</th>
              </tr>
            </thead>
            <tbody>
              {images.map((img) => {
                const f = img.features
                return (
                  <tr key={img.id}>
                    <td title={img.fileName}>{shortFileName(img.fileName)}</td>
                    <td>
                      <span className="cell-bar">
                        <span className="stat-track">
                          <span
                            className="stat-fill"
                            style={{ width: `${(f.meanLuminance / 255) * 100}%` }}
                          />
                        </span>
                        {Math.round(f.meanLuminance)}
                      </span>
                    </td>
                    <td className="nowrap">{luminanceBand(f.meanLuminance)}</td>
                    <td className="nowrap">
                      {Math.round(f.luminanceStd)}（{contrastBand(f.luminanceStd)}）
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="feature-block">
        <h3>边缘密度与视觉复杂度</h3>
        <ul className="metric-rows">
          {[...images]
            .sort((a, b) => b.features.edgeDensity - a.features.edgeDensity)
            .map((img) => (
              <li key={img.id}>
                <span className="metric-name" title={img.fileName}>
                  {shortFileName(img.fileName)}
                </span>
                <span className="stat-track">
                  <span
                    className="stat-fill"
                    style={{
                      width: `${Math.min(100, img.features.edgeDensity * 500)}%`,
                    }}
                  />
                </span>
                <span className="metric-value nowrap">
                  {pct(img.features.edgeDensity)} · {complexityBand(img.features.edgeDensity)}
                </span>
              </li>
            ))}
        </ul>
        <p className="feature-note">条形按边缘密度 ×5 放大显示以便对比；复杂度分档为经验值。</p>
      </section>

      <section className="feature-block">
        <h3>空间分布差异</h3>
        <div className="spatial-grids">
          <figure>
            <figcaption>各图平均边缘密度（典型布局）</figcaption>
            <div className="spatial-grid" style={{ aspectRatio: `${avgAspect}` }}>
              {spatial.avgEdgeDensity.map((v, i) =>
                Number.isFinite(v) ? (
                  <span
                    key={i}
                    className="edge-cell"
                    style={{ opacity: v / maxAvgEdge }}
                    title={`平均边缘密度 ${pct(v)}`}
                  />
                ) : (
                  <span key={i} className="no-data-cell" title="无有效数据" />
                ),
              )}
            </div>
          </figure>
          <figure>
            <figcaption>图片间差异（边缘密度标准差）</figcaption>
            <div className="spatial-grid" style={{ aspectRatio: `${avgAspect}` }}>
              {spatial.stdEdgeDensity.map((v, i) =>
                Number.isFinite(v) ? (
                  <span
                    key={i}
                    className="var-cell"
                    style={{ opacity: v / maxStdEdge }}
                    title={`图片间标准差 ${pct(v)}`}
                  />
                ) : (
                  <span key={i} className="no-data-cell" title="无有效数据" />
                ),
              )}
            </div>
          </figure>
        </div>
        <p className="feature-note">
          网格从左到右对应页面左侧→右侧，从上到下对应顶部→底部；各图网格按其自身宽高比划分，跨图对比以网格位置为准。悬停查看数值；差异图颜色越深表示该区域在各图之间的分歧越大。
        </p>
      </section>

      <section className="feature-block" aria-label="结构特征对比">
        <h3>结构特征对比（ScreenParser）</h3>
        {!structureComparison ? (
          <p className="feature-empty">
            尚未运行结构识别。在「单图分析」中为图片运行 ScreenParser 识别后，这里会展示跨图结构对比；不运行不影响上方的 Canvas 特征分析。
          </p>
        ) : (
          <>
            <p className="detection-summary">
              {structureEntries.length}/{n} 张图有检测结果
              {staleCount > 0 && `（最新 ${freshCount}，旧结果 ${staleCount}†）`}
              {structureMissing.length > 0 &&
                `（${structureMissing.map((i) => shortFileName(i.fileName)).join('、')} 未纳入对比）`}
            </p>
            {staleCount > 0 && (
              <p className="detection-hint">
                † 该图当前检测失败或服务不可用，使用的是最近一次成功的结果，可能不是最新。
              </p>
            )}

            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>UI 类别</th>
                    {structureEntries.map((e) => (
                      <th key={e.image.id} title={e.image.fileName}>
                        {shortFileName(e.image.fileName)}
                        {e.stale ? '†' : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {structureComparison.perClass.slice(0, 10).map((c) => (
                    <tr key={c.label}>
                      <td>{c.label}</td>
                      {structureEntries.map((e) => {
                        const hit = c.perImage.find(
                          (p) => p.fileName === e.image.fileName,
                        )
                        return (
                          <td key={e.image.id} className="nowrap">
                            {hit && hit.count > 0 ? (
                              hit.count
                            ) : (
                              <span className="dim">—</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="feature-note">
              数值为该图中检测到的元素数量；— 表示该图未运行识别或未检出该类别。
              带宽/高占比为检测框归一化到图片宽高后的统计，不等同于 CSS 实际渲染尺寸。
            </p>

            {structureComparison.sizeRanges.filter((s) => s.sampleCount >= 2).length > 0 && (
              <>
                <h4 className="reading-group-title">同类元素归一化尺寸（页宽 / 页高占比）</h4>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>UI 类别</th>
                        <th>归一化宽度</th>
                        <th>归一化高度</th>
                        <th>样本数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {structureComparison.sizeRanges
                        .filter((s) => s.sampleCount >= 2)
                        .slice(0, 6)
                        .map((s) => (
                          <tr key={s.label}>
                            <td>{s.label}</td>
                            <td className="nowrap">
                              {s.widthRange[0]}–{s.widthRange[1]}
                            </td>
                            <td className="nowrap">
                              {s.heightRange[0]}–{s.heightRange[1]}
                            </td>
                            <td className="nowrap">{s.sampleCount}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <p className="feature-note">
                  尺寸为检测框归一化到图片宽高后的范围，不等同于 CSS 实际渲染尺寸。
                </p>
              </>
            )}

            <h4 className="reading-group-title">跨图结构模式</h4>
            {structureComparison.patterns.length === 0 ? (
              <p className="feature-empty">
                未发现跨图一致的结构模式（样本不足或页面结构差异较大）。
              </p>
            ) : (
              <DesignReadings
                readings={structureComparison.patterns.map((p) => ({
                  text: p.text,
                  kind: 'inferred' as const,
                  basis: 'ScreenParser 检测·跨图对比（归一化坐标，模型推断而非 DOM 实测）',
                }))}
              />
            )}
            <p className="feature-note">
              <strong>判定阈值（经验值，存在不确定性）：</strong>
              对齐聚类容差为行 2.5% 页高 / 列 2% 页宽；尺寸一致性以各图平均归一化宽度差异
              ≤5% 页宽为界；用量模式要求至少出现在 60% 的对比图片中。紧凑布局可能被合并为同一行，
              跨页混排可能漏判一致性，结论请结合截图人工复核。
            </p>
          </>
        )}
      </section>
    </section>
  )
}
