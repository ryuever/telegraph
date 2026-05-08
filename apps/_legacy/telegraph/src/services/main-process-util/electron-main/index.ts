import { dialog, app, webContents } from 'electron'
import { injectable } from '@x-oasis/di'
import { TELEGRAPH_PAGELET_RENDERER_PROCESS_ID } from '@telegraph/core/node/process/env'
import type { IMainProcessUtils } from '../common/types'

/**
 * 从 webContents 的 URL 中提取可读的进程名称。
 * 主窗口 renderer URL 含 main-renderer-app，pagelet URL 含 pagelet.{name}。
 */
function resolveRendererName(wc: Electron.WebContents): string | undefined {
  try {
    const url = wc.getURL()
    if (!url) return undefined

    // 从 URL query 或 hash query 中提取 TELEGRAPH_PAGELET_RENDERER_PROCESS_ID
    const searchParams = new URLSearchParams(new URL(url).search)
    let processId = searchParams.get(TELEGRAPH_PAGELET_RENDERER_PROCESS_ID)

    if (!processId) {
      // dev 模式: 参数可能在 hash 的 ? 后面
      const hash = new URL(url).hash
      const hashQueryIndex = hash.indexOf('?')
      if (hashQueryIndex !== -1) {
        const hashParams = new URLSearchParams(hash.slice(hashQueryIndex + 1))
        processId = hashParams.get(TELEGRAPH_PAGELET_RENDERER_PROCESS_ID)
      }
    }

    if (!processId) return undefined

    // processId 格式举例:
    //   main-renderer-app → "main-renderer"
    //   window.2_panel.chat_pagelet.chat → "chat"
    if (processId.includes('main-renderer')) return 'main-renderer'

    // 提取 pagelet.{name} 中的 name
    const pageletMatch = processId.match(/pagelet\.(\w+)/)
    if (pageletMatch) return pageletMatch[1]

    return processId
  } catch {
    return undefined
  }
}

/**
 * 将只能用于主进程的工具方法作为一个服务提供给其他进程使用
 */
@injectable()
export class MainProcessUtils implements IMainProcessUtils {
  showOpenDialog: IMainProcessUtils['showOpenDialog'] = options => {
    return dialog.showOpenDialog(options)
  }

  showSaveDialog: IMainProcessUtils['showSaveDialog'] = options => {
    return dialog.showSaveDialog(options)
  }

  getAppMetrics: IMainProcessUtils['getAppMetrics'] = async () => {
    const metrics = app.getAppMetrics()

    // 构建 OS PID → 可读名称 的映射（通过遍历所有 webContents）
    const pidNameMap = new Map<number, string>()
    for (const wc of webContents.getAllWebContents()) {
      const osPid = wc.getOSProcessId()
      const name = resolveRendererName(wc)
      if (osPid && name) {
        pidNameMap.set(osPid, name)
      }
    }

    // 为 Browser（主进程）和 Tab（renderer）补全 name
    return metrics.map(m => {
      if (!m.name && m.type === 'Browser') {
        return { ...m, name: 'main-process' }
      }
      if (!m.name && pidNameMap.has(m.pid)) {
        return { ...m, name: pidNameMap.get(m.pid) }
      }
      return m
    })
  }
}
