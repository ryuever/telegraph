export const once = (event: Function) => (listener: Function, args?: any, disposable?: any) => {
  let didFired = false
  const result = event(
    e => {
      if (didFired) return
      if (result) {
        result.dispose()
      } else {
        didFired = true
      }
      return listener.call(args, e)
    },
    null,
    disposable
  )

  if (didFired) {
    result.dispose()
  }
  return result
}
