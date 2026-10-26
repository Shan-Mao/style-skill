import { Fragment } from 'react'
import { ChevronRightIcon } from './icons'

type WorkflowStep = {
  title: string
  description: string
}

const STEPS: WorkflowStep[] = [
  { title: '导入参考图', description: '上传界面截图或设计稿，作为风格来源' },
  { title: '分析视觉风格', description: '提取配色、字体、间距、组件形态等特征' },
  { title: '编辑设计规则', description: '审阅并调整结构化的设计规则' },
  { title: '导出 Skill', description: '生成供 AI 编程助手使用的 Agent Skill' },
]

export function WorkflowSteps() {
  return (
    <section className="workflow" aria-labelledby="workflow-heading">
      <h2 id="workflow-heading" className="section-title">
        工作流程
      </h2>
      <ol className="workflow-steps">
        {STEPS.map((step, index) => (
          <Fragment key={step.title}>
            {index > 0 && (
              <li className="workflow-sep" aria-hidden="true">
                <ChevronRightIcon size={15} />
              </li>
            )}
            <li className="workflow-step">
              <span className="step-number" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
            </li>
          </Fragment>
        ))}
      </ol>
    </section>
  )
}
