import { useCallback, useRef, useState } from 'react'
import { importImageFile } from '../lib/imageImport'
import type { ImportedImage } from '../lib/imageImport'

export type ImageLibrary = {
  images: ImportedImage[]
  selectedId: string | null
  isImporting: boolean
  importErrors: string[]
  addFiles: (files: FileList | File[]) => Promise<void>
  removeImage: (id: string) => void
  selectImage: (id: string) => void
  clearImportErrors: () => void
}

/**
 * 参考素材库状态。状态提升到 App 层，
 * 因此在「项目 / 参考素材」等视图之间切换时图片不会丢失。
 */
export function useImageLibrary(): ImageLibrary {
  const [images, setImages] = useState<ImportedImage[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [importErrors, setImportErrors] = useState<string[]>([])
  // 事件处理器里需要读取最新列表（计算删除后的选中回退），用 ref 镜像避免过期闭包
  const imagesRef = useRef<ImportedImage[]>([])

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (list.length === 0) return
    setIsImporting(true)
    setImportErrors([])
    const errors: string[] = []
    const accepted: ImportedImage[] = []
    for (const file of list) {
      try {
        accepted.push(await importImageFile(file))
      } catch (err) {
        errors.push(err instanceof Error ? err.message : `「${file.name}」导入失败`)
      }
    }
    if (accepted.length > 0) {
      imagesRef.current = [...imagesRef.current, ...accepted]
      setImages(imagesRef.current)
      setSelectedId(accepted[accepted.length - 1].id)
    }
    setImportErrors(errors)
    setIsImporting(false)
  }, [])

  const removeImage = useCallback((id: string) => {
    const target = imagesRef.current.find((img) => img.id === id)
    if (!target) return
    URL.revokeObjectURL(target.previewUrl)
    imagesRef.current = imagesRef.current.filter((img) => img.id !== id)
    setImages(imagesRef.current)
    setSelectedId((cur) => (cur === id ? (imagesRef.current[0]?.id ?? null) : cur))
  }, [])

  const selectImage = useCallback((id: string) => {
    setSelectedId(id)
  }, [])

  const clearImportErrors = useCallback(() => {
    setImportErrors([])
  }, [])

  return {
    images,
    selectedId,
    isImporting,
    importErrors,
    addFiles,
    removeImage,
    selectImage,
    clearImportErrors,
  }
}
