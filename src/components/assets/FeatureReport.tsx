import type { ReactNode } from 'react'
import { formatBytes } from '../../lib/imageImport'
import type { ImportedImage } from '../../lib/imageImport'
import { describeImage, UNANALYZED_ITEMS } from '../../lib/designLanguage'
import type { DetectionState } from '../../hooks/useDetections'
import {
  ColorDistribution,
  EdgeDensityStat,
  LuminanceDistribution,
  OrientationDistribution,
  SpatialDistribution,
} from './FeatureCharts'
import { DesignReadings } from './DesignReadings'
import { DetectionPanel } from './DetectionPanel'

type FeatureBlockProps = {
  title: string
  method: string
  limits: string
  children: ReactNode
}

function FeatureBlock({ title, method, limits, children }: FeatureBlockProps) {
  return (
    <section className="feature-block">
      <h3>{title}</h3>
      {children}
      <p className="feature-note">
        <strong>计算方式：</strong>
        {method}
      </p>
      <p className="feature-note">
        <strong>局限：</strong>
        {limits}
      </p>
    </section>
  )
}

export function FeatureReport({
  image,
  detection,
  onRunDetection,
}: {
  image: ImportedImage
  detection?: DetectionState
  onRunDetection: (image: ImportedImage) => void
}) {
  const f = image.features
  return (
    <section className="feature-report" aria-label={`${image.fileName} 的特征分析`}>
      <h2 className="section-title">特征分析</h2>
      <div className="feature-preview">
        <img src={image.previewUrl} alt={`${image.fileName} 预览`} />
        <div className="feature-preview-meta">
          <span className="feature-preview-name" title={image.fileName}>
            {image.fileName}
          </span>
          <span>
            {image.width} × {image.height} · {formatBytes(image.fileSize)}
          </span>
        </div>
      </div>
      <p className="feature-scope">
        分析基于缩放后的 {f.sampleWidth}×{f.sampleHeight} 采样。所有数值由确定性算法在本地计算，是可测量特征的客观统计，不包含对设计语义的判断。
      </p>
      {f.opaqueRatio < 0.5 && (
        <p className="feature-warn">
          该图 {Math.round((1 - f.opaqueRatio) * 100)}% 的像素是透明的，颜色与明度统计仅基于不透明区域。
        </p>
      )}

      <section className="feature-block">
        <h3>设计语言初判</h3>
        <DesignReadings readings={describeImage(f)} />
        <p className="feature-note">
          <strong>说明：</strong>
          分档判定（偏暗/偏亮、简洁/复杂等）为经验规则，用于快速理解数据，不代表设计规范。
        </p>
        <p className="feature-note">
          <strong>尚未分析：</strong>
          {UNANALYZED_ITEMS.join('、')}
          ——当前确定性指标无法可靠判断，需后续阶段或人工确认。
        </p>
      </section>

      <FeatureBlock
        title="颜色分布"
        method="采样像素按每通道 4 bit 量化分箱，合并 RGB 距离不超过 60 的相近颜色，取占比最高的 6 组；仅统计不透明像素。"
        limits="量化与合并会掩盖细微色差；色块颜色是聚类平均色，可能与图中具体像素略有偏差。"
      >
        <ColorDistribution colors={f.colors} remainder={f.colorRemainder} />
      </FeatureBlock>

      <FeatureBlock
        title="明度分布"
        method="每个不透明像素按 Rec.709 权重（0.2126 R + 0.7152 G + 0.0722 B）计算亮度，统计平均值、标准差与 16 档直方图。"
        limits="直接在 sRGB 数值上加权，未做 gamma 线性化，是感知亮度的近似值；标准差越大代表明暗对比越强。"
      >
        <LuminanceDistribution
          histogram={f.luminanceHistogram}
          mean={f.meanLuminance}
          std={f.luminanceStd}
        />
      </FeatureBlock>

      <FeatureBlock
        title="边缘密度"
        method={`灰度图上用 Sobel 3×3 算子计算梯度幅值，幅值大于 ${f.edgeThreshold} 的像素计为边缘（不含最外圈 1 像素），统计其占比。`}
        limits="阈值是经验值；缩放、压缩伪影与抗锯齿都会影响结果，更适合用于同批图片之间的横向对比。"
      >
        <EdgeDensityStat density={f.edgeDensity} />
      </FeatureBlock>

      <FeatureBlock
        title="线条方向"
        method="对边缘像素按梯度幅值加权，把边缘走向归入 6 个 30° 区间（0° 附近为水平边缘，90° 附近为垂直边缘）。"
        limits="粗略统计：曲线按局部切线计入所在区间，噪声会抬高斜向区间的占比。"
      >
        <OrientationDistribution bins={f.orientation} />
      </FeatureBlock>

      <FeatureBlock
        title="空间分布"
        method="把采样图划分为 4×4 网格，分别统计每格的平均亮度与边缘密度；网格保持原图宽高比。"
        limits="结果受背景与内容布局影响，不代表组件位置。边缘密度图按该图最大值相对着色，悬停可查看精确数值。"
      >
        <SpatialDistribution grid={f.grid} aspect={f.sampleWidth / f.sampleHeight} />
      </FeatureBlock>

      <DetectionPanel image={image} detection={detection} onRun={onRunDetection} />
    </section>
  )
}
