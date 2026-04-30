export type PromisifyService<T> = {
  [key in keyof T]: T[key] extends (...args: any[]) => any
    ? (
        ...args: [...Parameters<T[key]>]
      ) => ReturnType<T[key]> extends Promise<any>
        ? ReturnType<T[key]>
        : Promise<ReturnType<T[key]>>
    : T[key]
}
