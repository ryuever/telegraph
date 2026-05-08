import { format } from '@x-oasis/format-date'
import { colors, getUseColor, setUserColor } from '@x-oasis/ansi-colors'
import { DEFAULT_LOG_LEVEL } from './log'
import type { ILogger, IColor } from './types'
import { LogLevel } from './types'
import Logger from './Logger'

const now = () => format('MM/dd HH:mm:ss.sss', new Date())

const defaultColorConfigs: IColor = {
  entire: colors.green,
  entry: colors.magenta,
}

export class ConsoleMainLogger extends Logger implements ILogger {
  private useColors: boolean

  private colors: IColor

  private entryName: string

  constructor(props?: {
    entryName?: string
    logLevel?: LogLevel
    colors?: Partial<IColor>
    useColor?: boolean
  }) {
    super()
    const {
      entryName = 'main-process',
      logLevel = DEFAULT_LOG_LEVEL,
      colors = {},
      useColor = true,
    } = props || {}
    this.setLevel(logLevel)
    this.useColors = useColor
    this.entryName = entryName
    this.colors = {
      ...defaultColorConfigs,
      ...colors,
    }
  }

  format(args: any[]) {
    const prev = getUseColor()

    setUserColor(this.useColors)
    let heading = this.colors.entire(`[${now()} ${this.colors.entry(this.entryName)}]`)

    for (let idx = 0; idx < args.length; idx++) {
      const arg = args[idx]
      if (typeof arg === 'string') {
        // should merge with previous, or the second color param will not work on browser
        heading += ` ${arg}`
      } else {
        return [heading, ...args.slice(idx)]
      }
    }
    setUserColor(prev)

    return [heading]
  }

  trace(...args: any[]): void {
    // no implement
  }

  debug(...args: any[]): void {
    if (this.checkLogLevel(LogLevel.Debug)) {
      console.log(...this.format(args))
    }
  }

  info(...args: any[]): void {
    if (this.checkLogLevel(LogLevel.Info)) {
      console.log(...this.format(args))
    }
  }

  warn(...args: any[]): void {
    if (this.checkLogLevel(LogLevel.Warn)) {
      console.warn(...this.format(args))
    }
  }

  error(...args: any[]): void {
    if (this.checkLogLevel(LogLevel.Error)) {
      console.error(...this.format(args))
    }
  }

  fatal(...args: any[]): void {
    if (this.checkLogLevel(LogLevel.Fatal)) {
      this.error(...this.format(args))
    }
  }
}
