type InspectOptions = {
  depth?: number | null
}

export function format(first: unknown, ...args: unknown[]): string {
  if (typeof first !== 'string') return [first, ...args].map(value => inspect(value)).join(' ')
  let index = 0
  const message = first.replace(/%[sdjoO%]/g, token => {
    if (token === '%%') return '%'
    const value = args[index++]
    if (token === '%s') return String(value)
    if (token === '%d') return Number(value).toString()
    return inspect(value)
  })
  const rest = args.slice(index).map(value => inspect(value))
  return [message, ...rest].join(' ')
}

export function inspect(value: unknown, _options?: InspectOptions): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

export function debuglog(): (...args: unknown[]) => void {
  return () => {}
}

export function inherits(ctor: { prototype: object }, superCtor: { prototype: object }): void {
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype)
}

export const types = {
  isDate: (value: unknown): value is Date => value instanceof Date,
  isNativeError: (value: unknown): value is Error => value instanceof Error,
  isRegExp: (value: unknown): value is RegExp => value instanceof RegExp,
}

export const isArray = Array.isArray
export const isBuffer = (value: unknown): boolean => Boolean(value && typeof value === 'object' && '_isBuffer' in value)
export const isDate = types.isDate
export const isError = types.isNativeError
export const isRegExp = types.isRegExp
export const isString = (value: unknown): value is string => typeof value === 'string'
export const isNumber = (value: unknown): value is number => typeof value === 'number'
export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
export const isNull = (value: unknown): value is null => value === null
export const isNullOrUndefined = (value: unknown): value is null | undefined => value == null
export const isUndefined = (value: unknown): value is undefined => value === undefined
export const isFunction = (value: unknown): value is (...args: never[]) => unknown => typeof value === 'function'
export const isObject = (value: unknown): value is object => value !== null && typeof value === 'object'
export const isPrimitive = (value: unknown): boolean => value === null || (typeof value !== 'object' && typeof value !== 'function')

const util = {
  debuglog,
  format,
  inherits,
  inspect,
  isArray,
  isBoolean,
  isBuffer,
  isDate,
  isError,
  isFunction,
  isNull,
  isNullOrUndefined,
  isNumber,
  isObject,
  isPrimitive,
  isRegExp,
  isString,
  isUndefined,
  types,
}

export default util
