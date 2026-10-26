import { useState } from 'react'
import type { ReactNode } from 'react'

type PlaceholderButtonProps = {
  feature: string
  variant?: 'primary' | 'secondary'
  children: ReactNode
}

/** 占位按钮：对应功能尚未实现，点击后明确提示，而不是假装可用。 */
export function PlaceholderButton({ feature, variant = 'secondary', children }: PlaceholderButtonProps) {
  const [revealed, setRevealed] = useState(false)

  return (
    <span className="placeholder-action">
      <button type="button" className={`btn btn-${variant}`} onClick={() => setRevealed(true)}>
        {children}
      </button>
      {revealed && (
        <span className="placeholder-tip" role="status">
          「{feature}」尚未实现
        </span>
      )}
    </span>
  )
}
