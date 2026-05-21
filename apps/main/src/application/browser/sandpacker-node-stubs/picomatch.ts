interface PicomatchOptions {
  basename?: boolean
  contains?: boolean
  dot?: boolean
  ignore?: string | string[]
  matchBase?: boolean
  nocase?: boolean
  onIgnore?: (result: PicomatchResult) => void
  onMatch?: (result: PicomatchResult) => void
  onResult?: (result: PicomatchResult) => void
}

interface PicomatchResult {
  glob: string
  input: string
  isMatch: boolean
  match: RegExpExecArray | null
  output: string
  posix: boolean
  regex: RegExp
  state: PicomatchState
}

interface PicomatchState {
  input: string
  negated: boolean
  negatedExtglob: boolean
  output: string
}

type PicomatchMatcher = ((input: string, returnObject?: boolean) => boolean | PicomatchResult) & {
  state?: PicomatchState
}

type PicomatchFn = ((glob: string | string[], options?: PicomatchOptions, returnState?: boolean) => PicomatchMatcher) & {
  compileRe: (state: PicomatchState, options?: PicomatchOptions) => RegExp
  isMatch: (input: string, patterns: string | string[], options?: PicomatchOptions) => boolean
  makeRe: (glob: string, options?: PicomatchOptions) => RegExp & { state?: PicomatchState }
  matchBase: (input: string, glob: string | RegExp, options?: PicomatchOptions) => boolean
  parse: (pattern: string | string[], options?: PicomatchOptions) => PicomatchState | PicomatchState[]
  scan: (input: string) => { input: string; base: string; glob: string; isGlob: boolean; negated: boolean }
  test: (
    input: string,
    regex: RegExp,
    options?: PicomatchOptions,
    context?: { glob?: string; posix?: boolean },
  ) => { isMatch: boolean; match: RegExpExecArray | null; output: string }
  toRegex: (source: string, options?: PicomatchOptions) => RegExp
}

const REGEX_SPECIALS = /[|\\{}()[\]^$+?.]/g

const picomatch = ((glob: string | string[], options: PicomatchOptions = {}, returnState = false): PicomatchMatcher => {
  if (Array.isArray(glob)) {
    const matchers = glob.map(pattern => picomatch(pattern, options, returnState))
    const arrayMatcher: PicomatchMatcher = (input: string, returnObject = false) => {
      for (const matcher of matchers) {
        const result = matcher(input, returnObject)
        if (returnObject) {
          if (typeof result === 'object' && result.isMatch) return result
        } else if (result) {
          return true
        }
      }
      return returnObject ? createResult(input, glob[0] ?? '', /$a/, options, false) : false
    }
    return arrayMatcher
  }

  const state = parsePattern(glob)
  const regex = picomatch.makeRe(state.negated ? glob.slice(1) : glob, options)
  const ignore = options.ignore ? picomatch(options.ignore, { ...options, ignore: undefined }) : undefined

  const matcher = ((input: string, returnObject = false) => {
    const result = createResult(input, glob, regex, options, regex.test(normalizeInput(input, options)))
    if (result.isMatch && ignore?.(input)) {
      result.isMatch = false
      options.onIgnore?.(result)
    } else if (result.isMatch) {
      options.onMatch?.(result)
    }
    options.onResult?.(result)
    return returnObject ? result : result.isMatch
  }) as PicomatchMatcher

  if (returnState) matcher.state = state
  return matcher
}) as PicomatchFn

picomatch.isMatch = (input, patterns, options) => Boolean(picomatch(patterns, options)(input))

picomatch.matchBase = (input, glob, options) => {
  const value = basename(input)
  return glob instanceof RegExp ? glob.test(value) : Boolean(picomatch(glob, options)(value))
}

picomatch.test = (input, regex, options = {}, context = {}) => {
  const output = normalizeInput(input, options)
  const match = regex.exec(output)
  return {
    isMatch: Boolean(match) || output === context.glob,
    match,
    output,
  }
}

picomatch.parse = (pattern, options) => {
  if (Array.isArray(pattern)) return pattern.map(item => picomatch.parse(item, options) as PicomatchState)
  return parsePattern(pattern)
}

picomatch.scan = (input) => {
  const negated = input.startsWith('!')
  const value = negated ? input.slice(1) : input
  const slash = value.lastIndexOf('/')
  const glob = slash >= 0 ? value.slice(slash + 1) : value
  return {
    input,
    base: slash >= 0 ? value.slice(0, slash) : '',
    glob,
    isGlob: /[*?[{]/.test(value),
    negated,
  }
}

picomatch.compileRe = (state, options) => picomatch.toRegex(state.output, options)

picomatch.makeRe = (glob, options = {}) => {
  const state = parsePattern(glob)
  const source = globToRegexSource(state.negated ? glob.slice(1) : glob, options)
  const regex = picomatch.toRegex(options.contains ? source : `^${source}$`, options) as RegExp & { state?: PicomatchState }
  regex.state = state
  return regex
}

picomatch.toRegex = (source, options) => new RegExp(source, options?.nocase ? 'i' : '')

function parsePattern(pattern: string): PicomatchState {
  const negated = pattern.startsWith('!')
  const input = negated ? pattern.slice(1) : pattern
  return {
    input,
    negated,
    negatedExtglob: false,
    output: globToRegexSource(input, {}),
  }
}

function createResult(
  input: string,
  glob: string,
  regex: RegExp,
  options: PicomatchOptions,
  matched: boolean,
): PicomatchResult {
  const output = normalizeInput(input, options)
  const match = regex.exec(output)
  const state = parsePattern(glob)
  const isMatch = state.negated ? !matched : matched
  return {
    glob,
    input,
    isMatch,
    match,
    output,
    posix: true,
    regex,
    state,
  }
}

function globToRegexSource(pattern: string, options: PicomatchOptions): string {
  const normalized = normalizeInput(options.matchBase || options.basename ? basename(pattern) : pattern, options)
  let source = ''

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    const next = normalized[index + 1]
    if (char === '*') {
      if (next === '*') {
        source += '.*'
        index += 1
      } else {
        source += '[^/]*'
      }
      continue
    }
    if (char === '?') {
      source += '[^/]'
      continue
    }
    if (char === '{') {
      const end = normalized.indexOf('}', index + 1)
      if (end > index) {
        source += `(?:${normalized.slice(index + 1, end).split(',').map(escapeRegex).join('|')})`
        index = end
        continue
      }
    }
    source += char.replace(REGEX_SPECIALS, '\\$&')
  }

  if (!options.dot) {
    source = source.replace(/\[\^\/]\*/g, '(?!\\.)[^/]*')
  }
  return source
}

function normalizeInput(value: string, options: PicomatchOptions): string {
  const normalized = value.replace(/\\/g, '/')
  return options.matchBase || options.basename ? basename(normalized) : normalized
}

function basename(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(index + 1) : normalized
}

function escapeRegex(value: string): string {
  return value.replace(REGEX_SPECIALS, '\\$&')
}

export const compileRe = picomatch.compileRe
export const isMatch = picomatch.isMatch
export const makeRe = picomatch.makeRe
export const matchBase = picomatch.matchBase
export const parse = picomatch.parse
export const scan = picomatch.scan
export const test = picomatch.test
export const toRegex = picomatch.toRegex
export default picomatch
