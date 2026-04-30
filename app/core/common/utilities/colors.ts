// @ts-nocheck
// clone from https://github.com/alexeyraspopov/picocolors/blob/main/picocolors.js
// due to color not works on child process out, even refer to https://github.com/chalk/chalk/issues/381

const replaceClose = (string, close, replace, index) => {
  const start = string.substring(0, index) + replace
  const end = string.substring(index + close.length)
  const nextIndex = end.indexOf(close)
  return nextIndex !== -1 ? start + replaceClose(end, close, replace, nextIndex) : start + end
}

const formatter =
  (open, close, replace = open) =>
  input => {
    const string = `${input}`
    const index = string.indexOf(close, open.length)
    return index !== -1
      ? open + replaceClose(string, close, replace, index) + close
      : open + string + close
  }

let useColor = true

export const getUseColor = () => useColor
export const setUserColor = (value: boolean) => {
  useColor = value
}

const createColors = (enabled = true) => ({
  isColorSupported: enabled,
  reset: enabled && useColor ? s => `\x1b[0m${s}\x1b[0m` : String,
  bold: enabled && useColor ? formatter('\x1b[1m', '\x1b[22m', '\x1b[22m\x1b[1m') : String,
  dim: enabled && useColor ? formatter('\x1b[2m', '\x1b[22m', '\x1b[22m\x1b[2m') : String,
  italic: enabled && useColor ? formatter('\x1b[3m', '\x1b[23m') : String,
  underline: enabled && useColor ? formatter('\x1b[4m', '\x1b[24m') : String,
  inverse: enabled && useColor ? formatter('\x1b[7m', '\x1b[27m') : String,
  hidden: enabled && useColor ? formatter('\x1b[8m', '\x1b[28m') : String,
  strikethrough: enabled && useColor ? formatter('\x1b[9m', '\x1b[29m') : String,
  black: enabled && useColor ? formatter('\x1b[30m', '\x1b[39m') : String,
  red: enabled && useColor ? formatter('\x1b[31m', '\x1b[39m') : String,
  green: enabled && useColor ? formatter('\x1b[32m', '\x1b[39m') : String,
  yellow: enabled && useColor ? formatter('\x1b[33m', '\x1b[39m') : String,
  blue: enabled && useColor ? formatter('\x1b[34m', '\x1b[39m') : String,
  magenta: enabled && useColor ? formatter('\x1b[35m', '\x1b[39m') : String,
  cyan: enabled && useColor ? formatter('\x1b[36m', '\x1b[39m') : String,
  white: enabled && useColor ? formatter('\x1b[37m', '\x1b[39m') : String,
  gray: enabled && useColor ? formatter('\x1b[90m', '\x1b[39m') : String,
  bgBlack: enabled && useColor ? formatter('\x1b[40m', '\x1b[49m') : String,
  bgRed: enabled && useColor ? formatter('\x1b[41m', '\x1b[49m') : String,
  bgGreen: enabled && useColor ? formatter('\x1b[42m', '\x1b[49m') : String,
  bgYellow: enabled && useColor ? formatter('\x1b[43m', '\x1b[49m') : String,
  bgBlue: enabled && useColor ? formatter('\x1b[44m', '\x1b[49m') : String,
  bgMagenta: enabled && useColor ? formatter('\x1b[45m', '\x1b[49m') : String,
  bgCyan: enabled && useColor ? formatter('\x1b[46m', '\x1b[49m') : String,
  bgWhite: enabled && useColor ? formatter('\x1b[47m', '\x1b[49m') : String,
})

const colors = createColors()

export type Formatter = (str: string) => string

export { colors }
