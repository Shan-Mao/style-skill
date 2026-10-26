import { useCallback, useEffect, useRef, useState } from 'react'
import type { DesignRule, RuleCategory, RuleStatus } from '../lib/designRules'
import { buildInitialRules, mergeRules } from '../lib/designRules'
import type { ImportedImage } from '../lib/imageImport'
import type { DetectionStateMap } from '../lib/detectionClient'

export type DesignRulesState = {
  rules: DesignRule[]
  /** 用最新分析重建规则；已编辑/已确认/已忽略的规则不会被覆盖 */
  reinitFromAnalysis: () => void
  updateRule: (id: string, patch: { value?: string; status?: RuleStatus }) => void
  addRule: (rule: { category: RuleCategory; name: string; value: string }) => void
  removeRule: (id: string) => void
}

/**
 * 设计规则状态。提升到 App 层，因此在「参考素材 / 设计规则」等
 * 视图之间切换、或在单图/多图分析之间切换时，规则都不会丢失。
 *
 * 自动初始化只在用户尚未做过任何编辑动作时发生；
 * 用户手动修改后的规则不会被重新计算静默覆盖。
 * 传入 detections 后，「从分析重新生成」会包含 ScreenParser
 * 结构候选（同样受合并保护，不覆盖用户已改动的规则）。
 */
export function useDesignRules(
  images: ImportedImage[],
  detections: DetectionStateMap,
): DesignRulesState {
  const [rules, setRules] = useState<DesignRule[]>([])
  const userTouchedRef = useRef(false)
  const imagesRef = useRef(images)
  const detectionsRef = useRef(detections)

  useEffect(() => {
    imagesRef.current = images
    detectionsRef.current = detections
  }, [images, detections])

  useEffect(() => {
    if (images.length > 0 && rules.length === 0 && !userTouchedRef.current) {
      setRules(buildInitialRules(images, detectionsRef.current))
    }
  }, [images, rules.length])

  const reinitFromAnalysis = useCallback(() => {
    setRules((prev) =>
      mergeRules(prev, buildInitialRules(imagesRef.current, detectionsRef.current)),
    )
  }, [])

  const updateRule = useCallback((id: string, patch: { value?: string; status?: RuleStatus }) => {
    userTouchedRef.current = true
    setRules((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, ...patch, edited: patch.value !== undefined ? true : r.edited }
          : r,
      ),
    )
  }, [])

  const addRule = useCallback(
    (rule: { category: RuleCategory; name: string; value: string }) => {
      userTouchedRef.current = true
      setRules((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          category: rule.category,
          name: rule.name,
          value: rule.value,
          status: 'pending',
          source: 'manual',
          evidence: '手动创建的规则。',
          sourceImages: [],
          custom: true,
        },
      ])
    },
    [],
  )

  const removeRule = useCallback((id: string) => {
    userTouchedRef.current = true
    setRules((prev) => prev.filter((r) => r.id !== id))
  }, [])

  return { rules, reinitFromAnalysis, updateRule, addRule, removeRule }
}
