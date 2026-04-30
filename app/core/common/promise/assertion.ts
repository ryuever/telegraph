const toString = (val: any) => Object.prototype.toString.call(val)

export const isPromise = (obj: any) => {
  if (toString(obj) === '[object Promise]') return true
  if (toString(obj) === '[object Object]') {
    return typeof obj.then === 'function'
  }
  return false
}
