export type PidNodeProps = {
  pid: string
  ppid: string
  cpu: string
  mem: string
  command: string
}

export type PidRecord = string

export type PidNodeJson = {
  pid: string
  ppid: string
  cpu: string
  mem: string
  command: string
  children: PidNodeJson[]
}
