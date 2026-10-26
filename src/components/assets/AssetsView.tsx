import type { ImageLibrary } from '../../hooks/useImageLibrary'
import type { DetectionState } from '../../hooks/useDetections'
import type { ImportedImage } from '../../lib/imageImport'
import { FeatureReport } from './FeatureReport'
import { ImageThumb } from './ImageThumb'
import { ImportZone } from './ImportZone'
import { MultiSummary } from './MultiSummary'
import './assets.css'

export type ReportTab = 'summary' | 'single'

export function AssetsView({
  library,
  tab,
  onTabChange,
  detections,
  onRunDetection,
}: {
  library: ImageLibrary
  /** 由 App 持有，便于从设计规则的证据跳转直接定位到对应图片的单图分析 */
  tab: ReportTab
  onTabChange: (tab: ReportTab) => void
  detections: Record<string, DetectionState>
  onRunDetection: (image: ImportedImage) => void
}) {
  const {
    images,
    selectedId,
    isImporting,
    importErrors,
    addFiles,
    removeImage,
    selectImage,
    clearImportErrors,
  } = library
  const selected = images.find((img) => img.id === selectedId) ?? null
  const multiAvailable = images.length >= 2
  const showSummary = multiAvailable && tab === 'summary'

  return (
    <>
      <header className="workspace-header">
        <div>
          <h1>参考素材</h1>
          <p className="workspace-desc">
            导入界面截图或设计稿，提取可测量的视觉特征。所有计算在本地浏览器中完成，结果是确定性算法的客观统计，不包含对设计意图的判断。
          </p>
        </div>
      </header>
      <ImportZone
        isImporting={isImporting}
        errors={importErrors}
        onFiles={addFiles}
        onDismissErrors={clearImportErrors}
      />
      {images.length > 0 && (
        <section className="asset-list" aria-label="已导入的参考图">
          <h2 className="section-title">已导入 {images.length} 张</h2>
          <ul>
            {images.map((img) => (
              <ImageThumb
                key={img.id}
                image={img}
                selected={img.id === selectedId}
                onSelect={(id) => {
                  selectImage(id)
                  onTabChange('single')
                }}
                onRemove={removeImage}
              />
            ))}
          </ul>
        </section>
      )}
      {multiAvailable && (
        <div className="report-tabs" role="tablist" aria-label="分析视图">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'summary'}
            className={tab === 'summary' ? 'report-tab is-active' : 'report-tab'}
            onClick={() => onTabChange('summary')}
          >
            多图汇总
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'single'}
            className={tab === 'single' ? 'report-tab is-active' : 'report-tab'}
            onClick={() => onTabChange('single')}
          >
            单图分析
          </button>
        </div>
      )}
      {showSummary ? (
        <MultiSummary images={images} detections={detections} />
      ) : selected ? (
        <FeatureReport
          image={selected}
          detection={detections[selected.id]}
          onRunDetection={onRunDetection}
        />
      ) : (
        images.length > 0 && (
          <p className="asset-hint">在上方选择一张图片，查看它的特征分析。</p>
        )
      )}
    </>
  )
}
