import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatSettingsDialog } from '../components/ChatSettingsDialog'
import { DEFAULT_SETTINGS, type ChatModelSettings } from '../model-settings'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  const currentRoot = root
  if (currentRoot) {
    act(() => {
      currentRoot.unmount()
    })
  }
  root = undefined
  host?.remove()
  host = undefined
})

describe('ChatSettingsDialog capability settings', () => {
  it('edits shell command allowlists from the extensions tab', () => {
    const onSave = vi.fn()
    renderDialog({
      ...DEFAULT_SETTINGS,
      taskCapabilityProfile: {
        kind: 'shell-automation',
        commands: ['git'],
        cwdPolicy: 'workspace',
      },
    }, onSave)

    clickTab('Extensions')
    const textarea = getControl('Allowed shell commands') as HTMLTextAreaElement
    expect(textarea.value).toBe('git')

    change(textarea, 'git\npnpm, node')
    clickButton('Save')

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      taskCapabilityProfile: {
        kind: 'shell-automation',
        commands: ['git', 'pnpm', 'node'],
        cwdPolicy: 'workspace',
      },
    }))
  })

  it('persists design-build apply policy from the extensions tab', () => {
    const onSave = vi.fn()
    renderDialog({
      ...DEFAULT_SETTINGS,
      taskCapabilityProfile: {
        kind: 'design-build',
        scopes: ['artifact:write', 'repo:read'],
        artifactPolicy: 'preview',
      },
    }, onSave)

    clickTab('Extensions')
    const checkbox = getCheckbox('Allow artifact apply after confirmation')
    expect(checkbox.checked).toBe(false)

    click(checkbox)
    clickButton('Save')

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      taskCapabilityProfile: {
        kind: 'design-build',
        scopes: ['artifact:write', 'repo:read'],
        artifactPolicy: 'apply-after-confirm',
      },
    }))
  })
})

function renderDialog(settings: ChatModelSettings, onSave: (next: ChatModelSettings) => void): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  const currentRoot = createRoot(host)
  root = currentRoot
  act(() => {
    currentRoot.render(
      <ChatSettingsDialog
        open
        settings={settings}
        onClose={() => {}}
        onSave={onSave}
      />,
    )
  })
}

function clickTab(label: string): void {
  click(getButton(label))
}

function clickButton(label: string): void {
  click(getButton(label))
}

function getButton(label: string): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll('button'))
  const button = buttons.find(candidate => candidate.textContent.trim() === label)
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button "${label}" not found`)
  }
  return button
}

function getControl(label: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const labels = Array.from(document.querySelectorAll('label'))
  const labelEl = labels.find(candidate => candidate.textContent.includes(label))
  const control = labelEl?.querySelector('input, textarea, select')
  if (!control) {
    throw new Error(`Control "${label}" not found`)
  }
  return control as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
}

function getCheckbox(label: string): HTMLInputElement {
  const labels = Array.from(document.querySelectorAll('label'))
  const labelEl = labels.find(candidate => candidate.textContent.includes(label))
  const input = labelEl?.querySelector('input[type="checkbox"]')
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Checkbox "${label}" not found`)
  }
  return input
}

function change(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  act(() => {
    setNativeValue(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function click(element: HTMLElement): void {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const prototype = Object.getPrototypeOf(element) as { value?: string }
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
  descriptor?.set?.call(element, value)
}
