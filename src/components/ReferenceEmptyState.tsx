import { ImageIcon, UploadIcon } from './icons'

type ReferenceEmptyStateProps = {
  count: number
  onOpen: () => void
}

export function ReferenceEmptyState({ count, onOpen }: ReferenceEmptyStateProps) {
  const hasAssets = count > 0
  return (
    <section className="empty-state" aria-labelledby="empty-heading">
      <div className="empty-icon" aria-hidden="true">
        <ImageIcon size={22} />
      </div>
      <h2 id="empty-heading">
        {hasAssets ? `已导入 ${count} 张参考素材` : '还没有参考素材'}
      </h2>
      <p className="empty-desc">
        {hasAssets
          ? '已导入的素材可在「参考素材」中查看颜色、明度、边缘等基础特征分析。'
          : '从导入第一张参考图开始：支持 PNG / JPEG / WebP，图片仅在本地浏览器中处理。'}
      </p>
      <button type="button" className="btn btn-primary" onClick={onOpen}>
        <UploadIcon size={16} />
        {hasAssets ? '查看参考素材' : '前往导入参考图'}
      </button>
      <p className="empty-note">
        {hasAssets
          ? '完整流程：导入参考图 → 分析视觉风格 → 编辑设计规则 → 导出 Skill。'
          : '导入后可在「参考素材」中查看颜色、明度、边缘等基础特征分析。'}
      </p>
    </section>
  )
}
