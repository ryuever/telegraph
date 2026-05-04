import { spawn, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { access, cp, mkdir, readFile } from 'node:fs/promises'
import { constants, existsSync } from 'node:fs'
import { devNull, homedir, platform } from 'node:os'
import { dirname, join } from 'node:path'
import type { AgentRuntimeSettings } from '@telegraph/agent/types'

type PiCliStreamCallbacks = {
  onTextDelta: (text: string) => void
  onError: (reason: string, details: unknown) => void
  onDone: () => void | Promise<void>
}

type RunPiCliStreamInput = {
  runId?: string
  message: string
  settings: AgentRuntimeSettings
  signal?: AbortSignal
} & PiCliStreamCallbacks

type PiStreamEvent = {
  type?: string
  assistantMessageEvent?: {
    type?: string
    delta?: string
  }
  message?: unknown
  success?: boolean
  finalError?: string
}

type ResolvedPiSubagentsExtension = {
  extensionPath: string
  packageRoot?: string
}

const EXTENSION_RESOLVE_TIMEOUT_MS = 5000
const PI_LIST_TIMEOUT_MS = 2500

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, step: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${step} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    promise
      .then(value => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch(err => {
        clearTimeout(timer)
        reject(err)
      })
  })
}

function parsePiSubagentsInstallRoot(listOutput: string): string | null {
  const lines = listOutput.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i]?.includes('npm:pi-subagents')) continue
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j += 1) {
      const candidate = lines[j]?.trim()
      if (!candidate || !candidate.startsWith('/')) continue
      return candidate
    }
  }
  return null
}

async function resolveExtensionFromPackageRoot(packageRoot: string): Promise<string | null> {
  const packageJsonPath = join(packageRoot, 'package.json')
  try {
    const raw = await readFile(packageJsonPath, 'utf-8')
    const parsed = JSON.parse(raw) as {
      pi?: { extensions?: string[] }
    }
    const firstExt = parsed?.pi?.extensions?.[0]
    if (!firstExt) {
      return null
    }
    const resolved = join(packageRoot, firstExt)
    if (existsSync(resolved)) {
      return resolved
    }
  } catch {
    /* noop */
  }
  return null
}

async function resolvePiSubagentsExtensionPath(): Promise<ResolvedPiSubagentsExtension | null> {
  try {
    const pkg = require.resolve('pi-subagents/package.json')
    const localRoot = dirname(pkg)
    const localExtension = await resolveExtensionFromPackageRoot(localRoot)
    if (localExtension) return { extensionPath: localExtension, packageRoot: localRoot }
  } catch {
    /* noop */
  }

  const extDir = join(homedir(), '.pi', 'agent', 'extensions', 'subagent')
  try {
    await access(extDir, constants.F_OK)
    const extEntry = join(extDir, 'index.ts')
    return { extensionPath: extEntry }
  } catch {
    // Fall back to package discovery for user-level/global installs.
    const list = spawnSync('pi', ['list'], {
      encoding: 'utf-8',
      timeout: PI_LIST_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    })
    if (list.error) {
      return null
    }
    if (list.status !== 0) {
      return null
    }
    const out = `${list.stdout ?? ''}\n${list.stderr ?? ''}`
    const root = parsePiSubagentsInstallRoot(out)
    if (!root) return null
    const resolved = await resolveExtensionFromPackageRoot(root)
    return resolved ? { extensionPath: resolved, packageRoot: root } : null
  }
}

async function materializeAsarExtensionIfNeeded(
  extensionPath: string,
  packageRoot?: string
): Promise<string> {
  if (!extensionPath.includes('.asar') || !packageRoot) {
    return extensionPath
  }
  const runtimeRoot = join(homedir(), '.telegraph', 'pi-runtime', 'extensions', 'pi-subagents')
  await mkdir(runtimeRoot, { recursive: true })
  await cp(packageRoot, runtimeRoot, { recursive: true, force: true })
  const relativeExtPath = extensionPath.slice(packageRoot.length).replace(/^\/+/, '')
  return join(runtimeRoot, relativeExtPath)
}

function resolvePiExecutable(): string {
  const envBin = process.env.PI_BIN?.trim()
  if (envBin) return envBin
  const resourcesPath = (process as any).resourcesPath as string | undefined
  if (resourcesPath) {
    const bundled = join(
      resourcesPath,
      'pi-runtime',
      'bin',
      platform() === 'win32' ? 'pi.exe' : 'pi'
    )
    if (existsSync(bundled)) {
      return bundled
    }
  }
  return 'pi'
}

function normalizePiProvider(provider: string): string {
  const raw = provider.trim().toLowerCase().replace(/[_\s]+/g, '-')
  if (raw === 'minimaxcn') return 'minimax-cn'
  if (raw === 'minimax') return 'minimax'
  if (raw === 'minimax-cn') return 'minimax-cn'
  return raw
}

function buildPiChildEnv(settings: AgentRuntimeSettings): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  // App is often launched via pnpm; strip npm/pnpm-injected config noise from child process.
  // Those vars can trigger repetitive npm warnings in subagent toolchains.
  for (const key of Object.keys(env)) {
    const lower = key.toLowerCase()
    if (
      lower.startsWith('npm_config_') ||
      lower.startsWith('npm_package_') ||
      lower === 'npm_config_userconfig' ||
      lower === 'npm_config_globalconfig'
    ) {
      delete env[key]
    }
  }
  // Prevent npm user/global config warnings from leaking into subagent child logs.
  env.NPM_CONFIG_USERCONFIG = devNull
  env.npm_config_userconfig = devNull
  delete env.NPM_CONFIG_GLOBALCONFIG
  delete env.npm_config_globalconfig
  env.NPM_CONFIG_LOGLEVEL = 'error'
  env.npm_config_loglevel = 'error'
  const apiKey = settings.apiKey?.trim()
  if (!apiKey) {
    return env
  }

  const provider = normalizePiProvider(settings.provider ?? '')
  switch (provider) {
    case 'minimax-cn':
      env.MINIMAX_CN_API_KEY = apiKey
      break
    case 'minimax':
      env.MINIMAX_API_KEY = apiKey
      break
    case 'anthropic':
      env.ANTHROPIC_API_KEY = apiKey
      break
    case 'openai':
      env.OPENAI_API_KEY = apiKey
      break
    case 'gemini':
      env.GEMINI_API_KEY = apiKey
      break
    case 'minimax-openai-compat':
      env.OPENAI_API_KEY = apiKey
      env.OPENAI_COMPAT_API_KEY = apiKey
      break
    default:
      // Keep explicit --api-key as primary path; env fallback mainly helps child subagents.
      break
  }
  return env
}

function resolvePiTimeoutMs(settings: AgentRuntimeSettings): number {
  const override = Number(process.env.TELEGRAPH_PI_TIMEOUT_MS)
  if (Number.isFinite(override) && override >= 10_000) {
    return override
  }

  if (settings.orchestration === 'pi-subagents') {
    if (settings.orchestrationPattern === 'parallel') {
      return 420_000
    }
    return 300_000
  }
  return 120_000
}

function resolvePiStallTimeoutMs(settings: AgentRuntimeSettings): number {
  const override = Number(process.env.TELEGRAPH_PI_STALL_TIMEOUT_MS)
  if (Number.isFinite(override) && override >= 5_000) {
    return override
  }
  if (settings.orchestration === 'pi-subagents') {
    return 60_000
  }
  return 30_000
}

function buildPiArgs(
  message: string,
  settings: AgentRuntimeSettings,
  extensionPath?: string
): string[] {
  const args = ['-p', '--mode', 'json']
  if (settings.provider) {
    const provider = normalizePiProvider(settings.provider)
    if (provider === 'minimax-openai-compat') {
      throw new Error(
        'pi-cli backend does not support provider "minimax-openai-compat". Use provider "minimax"/"minimax-cn", or switch backend to pi-ai.'
      )
    }
    args.push('--provider', provider)
  }
  if (settings.modelId) {
    args.push('--model', settings.modelId)
  }
  if (settings.apiKey) {
    // Explicit key flag avoids any dependency on ~/.pi/agent/models.json.
    args.push('--api-key', settings.apiKey)
  }
  if (extensionPath) {
    args.push('--no-extensions', '--extension', extensionPath)
  }
  args.push(buildPiPrompt(message, settings))
  return args
}

function squashWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}

function buildPiPrompt(message: string, settings: AgentRuntimeSettings): string {
  if (settings.orchestration !== 'pi-subagents') {
    return message
  }

  const task = squashWhitespace(message)
  const worktreeHint = settings.worktreeIsolation
    ? '\nSet worktree=true for parallel tasks to avoid write conflicts.'
    : ''

  const pattern = settings.orchestrationPattern ?? 'chain'
  if (pattern === 'parallel') {
    return [
      'Use the `subagent` tool (from pi-subagents) now with exactly these parameters:',
      '{',
      '  "tasks": [',
      `    {"agent":"scout","task":"${task}"},`,
      `    {"agent":"planner","task":"${task}"},`,
      `    {"agent":"worker","task":"${task}"},`,
      `    {"agent":"reviewer","task":"${task}"}`,
      '  ],',
      '  "clarify": false,',
      '  "async": false,',
      '  "agentScope": "both"',
      '}',
      'After tasks complete, return one final concise answer.',
      worktreeHint,
    ]
      .filter(Boolean)
      .join('\n')
  }

  return [
    'Use the `subagent` tool (from pi-subagents) now with exactly these parameters:',
    '{',
    '  "chain": [',
    `    {"agent":"scout","task":"${task}"},`,
    '    {"agent":"planner","task":"{previous}"},',
    '    {"agent":"worker","task":"{previous}"},',
    '    {"agent":"reviewer","task":"{previous}"}',
    '  ],',
    '  "clarify": false,',
    '  "async": false,',
    '  "agentScope": "both"',
    '}',
    'After chain completes, return one final concise answer.',
    worktreeHint,
  ].join('\n')
}

function parsePiMessage(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object') {
    try {
      return JSON.stringify(raw)
    } catch {
      return String(raw)
    }
  }
  return String(raw ?? '')
}

function stderrTail(stderrAcc: string, maxChars = 2000): string {
  const trimmed = stderrAcc.trim()
  if (!trimmed) return ''
  return trimmed.length <= maxChars ? trimmed : trimmed.slice(-maxChars)
}

export async function runPiCliStream({
  runId,
  message,
  settings,
  signal,
  onTextDelta,
  onError,
  onDone,
}: RunPiCliStreamInput): Promise<void> {
  if (!settings.apiKey?.trim()) {
    throw new Error(
      'pi-cli backend requires an API key from Chat settings (.env or per-provider key). No fallback to ~/.pi/agent/models.json is used.'
    )
  }
  const orchestration = settings.orchestration ?? 'none'
  let subagentExtensionPath: string | null = null
  if (orchestration === 'pi-subagents') {
    console.info(
      '[AgentStreamService] resolving pi-subagents extension',
      JSON.stringify({ runId: runId ?? null })
    )
    const resolvedSubagent = await withTimeout(
      resolvePiSubagentsExtensionPath(),
      EXTENSION_RESOLVE_TIMEOUT_MS,
      'resolve pi-subagents extension'
    )
    if (!resolvedSubagent) {
      throw new Error(
        'pi-subagents extension is not available. Install project-local dependency or run: `pi install npm:pi-subagents`'
      )
    }
    subagentExtensionPath = await materializeAsarExtensionIfNeeded(
      resolvedSubagent.extensionPath,
      resolvedSubagent.packageRoot
    )
    console.info(
      '[AgentStreamService] resolved pi-subagents extension',
      JSON.stringify({ runId: runId ?? null, extensionPath: subagentExtensionPath })
    )
  }

  const args = buildPiArgs(message, settings, subagentExtensionPath ?? undefined)
  const piExecutable = resolvePiExecutable()
  const childEnv = buildPiChildEnv(settings)
  const redactedArgs = args.map((value, index, all) =>
    all[index - 1] === '--api-key' ? '***' : value
  )
  console.info(
    '[AgentStreamService] pi-cli spawn',
    JSON.stringify({
      runId: runId ?? null,
      backend: 'pi-cli',
      provider: normalizePiProvider(settings.provider ?? ''),
      modelId: settings.modelId ?? '',
      orchestration: settings.orchestration ?? 'none',
      pattern: settings.orchestrationPattern ?? null,
      hasApiKey: Boolean(settings.apiKey?.trim()),
      executable: piExecutable,
      args: redactedArgs,
      hasProjectExtension: Boolean(subagentExtensionPath),
    })
  )
  await new Promise<void>((resolve, reject) => {
    const child = spawn(piExecutable, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
    })

    let didError = false
    /** Pi JSON stream signaled session end before process exited (common with extensions / -p). */
    let completionNotified = false
    let lingerKill: NodeJS.Timeout | null = null
    let stderrAcc = ''
    let lastStderrLogMs = 0
    const hardTimeoutMs = resolvePiTimeoutMs(settings)
    const stallTimeoutMs = resolvePiStallTimeoutMs(settings)
    let lastActivityMs = Date.now()

    const notifyComplete = async () => {
      if (didError || completionNotified) return
      completionNotified = true
      clearInterval(stallWatchdog)
      clearTimeout(hardTimeout)
      // End the pi process *before* awaiting sink RPC. If flushPush to the main process
      // hangs, we must still close the child; otherwise hardTimeout was cleared and we'd
      // deadlock until the renderer invoke_timeout.
      if (!signal?.aborted && child.exitCode === null && !child.killed) {
        child.kill('SIGTERM')
      }
      lingerKill = setTimeout(() => {
        if (child.exitCode === null && !child.killed) {
          console.warn(
            '[AgentStreamService] pi-cli still alive after agent_end; sending SIGKILL',
            JSON.stringify({ runId: runId ?? null })
          )
          child.kill('SIGKILL')
        }
      }, 20_000)
      const onDoneMs = Math.min(60_000, Math.max(5_000, Math.floor(hardTimeoutMs / 4)))
      try {
        await Promise.race([
          Promise.resolve(onDone()),
          new Promise<void>((resolve) => {
            setTimeout(() => {
              console.warn(
                '[AgentStreamService] onDone (sink flush) slow; continuing',
                JSON.stringify({ runId: runId ?? null, waitedMs: onDoneMs })
              )
              resolve()
            }, onDoneMs)
          }),
        ])
      } catch (err) {
        console.error(
          '[AgentStreamService] onDone after session complete failed',
          err instanceof Error ? err.message : String(err)
        )
      }
    }

    const hardTimeout = setTimeout(() => {
      if (didError) return
      if (lingerKill) {
        clearTimeout(lingerKill)
        lingerKill = null
      }
      didError = true
      const tail = stderrTail(stderrAcc)
      onError(
        'pi_timeout',
        `pi-cli did not finish within ${hardTimeoutMs}ms${tail ? `; stderr_tail: ${tail}` : ''}`
      )
      child.kill('SIGKILL')
    }, hardTimeoutMs)
    const stallWatchdog = setInterval(() => {
      if (didError) return
      const idleForMs = Date.now() - lastActivityMs
      if (idleForMs < stallTimeoutMs) return
      if (lingerKill) {
        clearTimeout(lingerKill)
        lingerKill = null
      }
      didError = true
      const tail = stderrTail(stderrAcc)
      onError(
        'pi_stalled',
        `pi-cli produced no output for ${idleForMs}ms (stall timeout ${stallTimeoutMs}ms)${
          tail ? `; stderr_tail: ${tail}` : ''
        }`
      )
      child.kill('SIGKILL')
    }, 1000)

    const abortHandler = () => {
      child.kill('SIGTERM')
    }
    signal?.addEventListener('abort', abortHandler, { once: true })

    const dispatchPiStreamLine = (line: string) => {
      let evt: PiStreamEvent | null = null
      try {
        evt = JSON.parse(line) as PiStreamEvent
      } catch {
        return
      }
      lastActivityMs = Date.now()
      if (!evt?.type) return

      if (evt.type === 'message_update' && evt.assistantMessageEvent) {
        const d = evt.assistantMessageEvent.delta
        if (typeof d === 'string' && d.length > 0) {
          onTextDelta(d)
        }
        return
      }

      // Pi JSON mode: session completes with agent_end; the process may not exit immediately
      // (see pi-mono packages/coding-agent/docs/json.md). Without this, ipc.invoke can hang
      // until the renderer invoke_timeout (e.g. parallel pi-subagents).
      if (evt.type === 'agent_end') {
        console.info(
          '[AgentStreamService] pi-cli agent_end (session complete)',
          JSON.stringify({ runId: runId ?? null })
        )
        void notifyComplete().catch(err => {
          console.error(
            '[AgentStreamService] notifyComplete after agent_end failed',
            err instanceof Error ? err.message : String(err)
          )
        })
        return
      }

      if (evt.type === 'error') {
        didError = true
        onError('pi_error', parsePiMessage(evt.message))
        return
      }

      if (evt.type === 'auto_retry_end' && evt.success === false) {
        didError = true
        onError('pi_retry_exhausted', evt.finalError ?? 'pi exhausted automatic retries')
      }
    }

    const rl = createInterface({ input: child.stdout })
    rl.on('line', dispatchPiStreamLine)

    let stderrLineCarry = ''
    child.stderr.on('data', chunk => {
      const text = chunk.toString()
      lastActivityMs = Date.now()
      stderrAcc += text
      stderrLineCarry += text
      const parts = stderrLineCarry.split(/\r?\n/)
      stderrLineCarry = parts.pop() ?? ''
      for (const part of parts) {
        if (part.trim().length > 0) {
          dispatchPiStreamLine(part)
        }
      }
      const now = Date.now()
      if (now - lastStderrLogMs >= 1000) {
        lastStderrLogMs = now
        console.warn(
          '[AgentStreamService] pi-cli stderr chunk',
          JSON.stringify({
            runId: runId ?? null,
            provider: normalizePiProvider(settings.provider ?? ''),
            modelId: settings.modelId ?? '',
            tail: stderrTail(text, 500),
          })
        )
      }
    })

    child.on('error', err => {
      didError = true
      if (lingerKill) {
        clearTimeout(lingerKill)
        lingerKill = null
      }
      clearTimeout(hardTimeout)
      clearInterval(stallWatchdog)
      signal?.removeEventListener('abort', abortHandler)
      reject(err)
    })

    child.on('close', code => {
      if (stderrLineCarry.trim().length > 0) {
        dispatchPiStreamLine(stderrLineCarry.trim())
      }
      if (lingerKill) {
        clearTimeout(lingerKill)
        lingerKill = null
      }
      clearTimeout(hardTimeout)
      clearInterval(stallWatchdog)
      signal?.removeEventListener('abort', abortHandler)
      void (async () => {
        try {
          if (signal?.aborted) {
            if (!completionNotified) {
              didError = true
              onError('aborted', 'execution cancelled')
            }
            resolve()
            return
          }
          if (code !== 0 && !didError && !completionNotified) {
            didError = true
            const msg = stderrTail(stderrAcc) || `pi exited with code ${code}`
            console.error(
              '[AgentStreamService] pi-cli exited with non-zero code',
              JSON.stringify({
                runId: runId ?? null,
                code,
                provider: normalizePiProvider(settings.provider ?? ''),
                modelId: settings.modelId ?? '',
                orchestration: settings.orchestration ?? 'none',
              })
            )
            onError('pi_exit', msg)
          }
          if (!didError && !completionNotified) {
            await Promise.resolve(onDone())
          }
          resolve()
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      })()
    })
  })
}
