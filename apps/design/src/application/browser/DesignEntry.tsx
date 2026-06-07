import { useRef, useState } from 'react'
import type { JSX } from 'react'
import { Sparkles } from 'lucide-react'
import type { DesignConfiguredModelDescriptorSnapshot } from '@/apps/design/application/common'
import { Button } from '@/packages/ui/components/ui/button'
import { Textarea } from '@/packages/ui/components/ui/textarea'
import { DesignPromptControls } from './DesignPromptControls'

const QUICK_PROMPT_OPTIONS = [
  {
    label: 'SaaS 数据看板',
    prompt: '设计一个面向运营团队的 SaaS 数据看板，包含关键指标、趋势图、待办事项和异常提醒。',
  },
  {
    label: '项目任务板',
    prompt: '设计一个项目任务管理界面，包含任务分组、负责人、优先级、进度状态和右侧详情面板。',
  },
  {
    label: '个人简介页面',
    prompt: '设计一个个人简介页面，包含头像、姓名与职业标题、个人介绍、技能标签、项目经历、联系方式和清晰的行动按钮。',
  },
  {
    label: '移动端启动页',
    prompt: '设计一个移动端应用启动与 onboarding 界面，包含品牌首屏、三步引导和清晰的主行动按钮。',
  },
  {
    label: 'AI 助手工作台',
    prompt: '设计一个 AI 助手工作台，包含对话区、工具调用记录、上下文资料栏和运行状态提示。',
  },
] as const

interface DesignEntryProps {
  onSubmit: (prompt: string) => void
  onOpenSettings?: () => void
  configuredModels?: DesignConfiguredModelDescriptorSnapshot[]
  selectedProvider?: string
  selectedModelId?: string
  onModelSelect?: (provider: string, modelId: string) => void
  modelReady?: boolean
  modelsLoading?: boolean
}

export function DesignEntry({
  onSubmit,
  onOpenSettings,
  configuredModels = [],
  selectedProvider,
  selectedModelId,
  onModelSelect,
  modelReady = false,
  modelsLoading = false,
}: DesignEntryProps): JSX.Element {
  const [prompt, setPrompt] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = () => {
    if (prompt.trim() && modelReady) {
      onSubmit(prompt.trim())
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setPrompt(e.target.value)
  }

  const handleQuickPrompt = (nextPrompt: string): void => {
    setPrompt(nextPrompt)
    textareaRef.current?.focus()
  }

  return (
    <div className="flex h-full flex-col items-center justify-center bg-background px-6">
      <div className="mb-6 flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
          <span className="h-2 w-2 rounded-full bg-accent-mint" />
          <span>Design workspace</span>
        </div>
      </div>
      <h1 className="mb-7 text-2xl font-semibold text-foreground">
        你想创建什么界面？
      </h1>
      <div className="w-full max-w-[680px]">
        <div className="rounded-md border border-border bg-card shadow-sm">
          <Textarea
            ref={textareaRef}
            value={prompt}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="描述你想要生成的界面..."
            className="min-h-[96px] resize-none border-0 bg-transparent px-4 pt-4 text-[15px] shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-between gap-3 border-t border-border/70 px-3 py-3">
            <DesignPromptControls
              configuredModels={configuredModels}
              provider={selectedProvider}
              modelId={selectedModelId}
              onModelSelect={onModelSelect}
              onOpenSettings={onOpenSettings}
              loading={modelsLoading}
            />
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!prompt.trim() || !modelReady}
              title={modelReady ? 'Generate design' : 'Configure a provider model in Settings / Providers'}
              className="rounded-md"
            >
              <Sparkles size={14} />
              生成
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {QUICK_PROMPT_OPTIONS.map(option => (
            <Button
              key={option.label}
              type="button"
              size="sm"
              variant="outline"
              aria-label={`使用快捷选项：${option.label}`}
              onClick={() => { handleQuickPrompt(option.prompt) }}
              className="h-8 rounded-md px-3 text-xs text-muted-foreground hover:text-foreground"
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
