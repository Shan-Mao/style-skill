import type { Reading } from '../../lib/designLanguage'
import { shortFileName } from '../../lib/imageImport'

export function DesignReadings({ readings }: { readings: Reading[] }) {
  return (
    <ul className="readings">
      {readings.map((r, i) => (
        <li key={i} className="reading">
          <span
            className={
              r.kind === 'measured'
                ? 'reading-badge is-measured'
                : 'reading-badge is-inferred'
            }
          >
            {r.kind === 'measured' ? '实测' : '推断'}
          </span>
          <div>
            <p className="reading-text">{r.text}</p>
            <p className="reading-meta">
              依据：{r.basis}
              {r.sources && r.sources.length > 0
                ? ` · 图片：${r.sources.map(shortFileName).join('、')}`
                : ''}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}
