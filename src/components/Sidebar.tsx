import type { ComponentType } from 'react'
import type { IconProps } from './icons'
import { FolderIcon, ImageIcon, PackageIcon, SlidersIcon } from './icons'
import brandLogo from '../assets/styleskill-logo.png'

export type ViewId = 'projects' | 'assets' | 'editor' | 'skill'

type NavItem = {
  id: ViewId
  label: string
  icon: ComponentType<IconProps>
}

const NAV_ITEMS: NavItem[] = [
  { id: 'projects', label: '项目', icon: FolderIcon },
  { id: 'assets', label: '参考素材', icon: ImageIcon },
  { id: 'editor', label: '风格编辑器', icon: SlidersIcon },
  { id: 'skill', label: 'Skill 生成', icon: PackageIcon },
]

type SidebarProps = {
  active: ViewId
  onSelect: (view: ViewId) => void
}

export function Sidebar({ active, onSelect }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img className="brand-logo" src={brandLogo} alt="" width={22} height={22} />
        <span className="brand-name">Style Skill</span>
      </div>
      <nav className="sidebar-nav" aria-label="功能导航">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={id === active ? 'nav-item is-active' : 'nav-item'}
            aria-current={id === active ? 'page' : undefined}
            onClick={() => onSelect(id)}
          >
            <Icon size={17} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <p className="sidebar-footer">设计令牌已就绪</p>
    </aside>
  )
}
