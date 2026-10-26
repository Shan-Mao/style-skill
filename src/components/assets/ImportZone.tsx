import { useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { formatBytes, MAX_FILE_SIZE } from '../../lib/imageImport'
import { UploadIcon } from '../icons'

type ImportZoneProps = {
  isImporting: boolean
  errors: string[]
  onFiles: (files: FileList | File[]) => void
  onDismissErrors: () => void
}

export function ImportZone({ isImporting, errors, onFiles, onDismissErrors }: ImportZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [isDragging, setIsDragging] = useState(false)

  const openPicker = () => {
    if (!isImporting) inputRef.current?.click()
  }

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openPicker()
    }
  }

  const handleDragEnter = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragDepth.current += 1
    setIsDragging(true)
  }

  const handleDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }

  const handleDragLeave = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setIsDragging(false)
  }

  const handleDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragDepth.current = 0
    setIsDragging(false)
    const files = e.dataTransfer?.files
    if (files && files.length > 0) onFiles(files)
  }

  const zoneClass = [
    'import-zone',
    isDragging ? 'is-dragging' : '',
    isImporting ? 'is-busy' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div>
      <div
        className={zoneClass}
        role="button"
        tabIndex={0}
        aria-label="导入参考图：点击选择图片，或将图片拖拽到此处"
        onClick={openPicker}
        onKeyDown={handleKeyDown}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <span className="btn btn-primary">
          <UploadIcon size={16} />
          {isImporting ? '正在处理…' : '选择图片'}
        </span>
        <p className="import-hint">
          或拖拽图片到此处 · PNG / JPEG / WebP · 单张不超过 {formatBytes(MAX_FILE_SIZE)}
        </p>
        <p className="import-privacy">图片仅在本地浏览器中读取与计算，不会上传。</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) onFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
      {errors.length > 0 && (
        <div className="import-errors" role="alert">
          <ul>
            {errors.map((msg, i) => (
              <li key={`${i}-${msg}`}>{msg}</li>
            ))}
          </ul>
          <button type="button" className="import-errors-dismiss" onClick={onDismissErrors}>
            知道了
          </button>
        </div>
      )}
    </div>
  )
}
