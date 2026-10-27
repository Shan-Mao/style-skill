import { useEffect, useState } from 'react'
import { AssetsView } from './components/assets/AssetsView'
import type { ReportTab } from './components/assets/AssetsView'
import { PlaceholderButton } from './components/PlaceholderButton'
import { ReferenceEmptyState } from './components/ReferenceEmptyState'
import { RulesEditor } from './components/editor/RulesEditor'
import { Sidebar } from './components/Sidebar'
import type { ViewId } from './components/Sidebar'
import { SkillExportView } from './components/skill/SkillExportView'
import { WorkflowSteps } from './components/WorkflowSteps'
import { PlusIcon } from './components/icons'
import { useDesignRules } from './hooks/useDesignRules'
import { useDetections } from './hooks/useDetections'
import { useImageLibrary } from './hooks/useImageLibrary'
import { initTauriBridge } from './lib/tauriBridge'
import './App.css'
import './styles/visual-theme.css'

function App() {
  const [view, setView] = useState<ViewId>('projects')
  const library = useImageLibrary()
  const detectionsState = useDetections()
  const rulesState = useDesignRules(library.images, detectionsState.detections)
  // 由 App 持有，便于从设计规则的证据跳转直接定位到对应图片的单图分析
  const [assetsTab, setAssetsTab] = useState<ReportTab>('summary')

  // Tauri 桌面模式：向后端查询推理服务动态端口；Web 模式为空操作
  useEffect(() => {
    void initTauriBridge()
  }, [])

  const showImageEvidence = (imageId: string) => {
    if (!library.images.some((img) => img.id === imageId)) return
    library.selectImage(imageId)
    setAssetsTab('single')
    setView('assets')
  }

  return (
    <div className="app">
      <Sidebar active={view} onSelect={setView} />
      <main className="workspace">
        <div className="workspace-content">
          {view === 'projects' && (
            <ProjectsView
              onOpenAssets={() => setView('assets')}
              assetCount={library.images.length}
            />
          )}
          {view === 'assets' && (
            <AssetsView
              library={library}
              tab={assetsTab}
              onTabChange={setAssetsTab}
              detections={detectionsState.detections}
              onRunDetection={detectionsState.runDetection}
            />
          )}
          {view === 'editor' && (
            <RulesEditor
              rules={rulesState.rules}
              images={library.images}
              detections={detectionsState.detections}
              onReinit={rulesState.reinitFromAnalysis}
              onUpdate={rulesState.updateRule}
              onAdd={rulesState.addRule}
              onRemove={rulesState.removeRule}
              onShowImage={showImageEvidence}
              onGoToAssets={() => setView('assets')}
            />
          )}
          {view === 'skill' && (
            <SkillExportView rules={rulesState.rules} onGoToRules={() => setView('editor')} />
          )}
        </div>
      </main>
    </div>
  )
}

function ProjectsView({
  onOpenAssets,
  assetCount,
}: {
  onOpenAssets: () => void
  assetCount: number
}) {
  return (
    <>
      <header className="workspace-header">
        <div>
          <p className="workspace-eyebrow">项目</p>
          <h1>未命名项目</h1>
          <p className="workspace-desc">
            上传参考图片，提取界面中的视觉设计风格，编辑结构化的设计规则，并生成可供 AI
            编程助手使用的 Agent Skill。
          </p>
        </div>
        <PlaceholderButton variant="primary" feature="创建项目">
          <PlusIcon size={16} />
          新建项目
        </PlaceholderButton>
      </header>
      <WorkflowSteps />
      <ReferenceEmptyState onOpen={onOpenAssets} count={assetCount} />
    </>
  )
}

export default App
