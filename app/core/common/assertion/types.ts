import { CharCode } from './CharCode'
export { Iterable } from './iterable'

export function isObject(thing: any): thing is Object {
  return typeof thing === 'object' && thing !== null
}

export function isFunction(thing: any): thing is Function {
  return typeof thing === 'function'
}

export function isArray(thing: any) {
  return Array.isArray(thing)
}

export type Ctor<T = object> = new (...args: any[]) => T

// https://stackoverflow.com/a/43197340
export function isClass(thing: any): thing is Ctor {
  const isCtorClass = thing.constructor && thing.constructor.toString().substring(0, 5) === 'class'
  if (thing.prototype === undefined) return isCtorClass
  const isPrototypeCtorClass =
    thing.prototype.constructor &&
    thing.prototype.constructor.toString &&
    thing.prototype.constructor.toString().substring(0, 5) === 'class'
  return isCtorClass || isPrototypeCtorClass
}

export function isAsciiDigit(code: number): boolean {
  return code >= CharCode.Digit0 && code <= CharCode.Digit9
}

export function isLowerAsciiLetter(code: number): boolean {
  return code >= CharCode.a && code <= CharCode.z
}

export function isUpperAsciiLetter(code: number): boolean {
  return code >= CharCode.A && code <= CharCode.Z
}
