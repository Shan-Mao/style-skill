import { formatBytes } from '../../lib/imageImport'
import type { ImportedImage } from '../../lib/imageImport'
import { XIcon } from '../icons'

type ImageThumbProps = {
  image: ImportedImage
  selected: boolean
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}

export function ImageThumb({ image, selected, onSelect, onRemove }: ImageThumbProps) {
  return (
    <li className={selected ? 'asset-thumb is-selected' : 'asset-thumb'}>
      <button
        type="button"
        className="asset-select"
        aria-pressed={selected}
        onClick={() => onSelect(image.id)}
      >
        <img src={image.previewUrl} alt={image.fileName} />
        <span className="asset-name" title={image.fileName}>
          {image.fileName}
        </span>
        <span className="asset-meta">
          {image.width}×{image.height} · {formatBytes(image.fileSize)}
        </span>
      </button>
      <button
        type="button"
        className="asset-remove"
        aria-label={`移除 ${image.fileName}`}
        onClick={() => onRemove(image.id)}
      >
        <XIcon size={12} />
      </button>
    </li>
  )
}
