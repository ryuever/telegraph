export type IUtilityProcessInfo = {
  readonly pid: number
  readonly name: string
}

export type IUtilityProcessConfig = {
  readonly id: string
  readonly serviceName: string
  readonly entry: string
  readonly env?: {
    [key: string]: string
  }
  readonly args?: string[]
  readonly ppid: number

  readonly projectName?: string

  amdEntry?: string
}
