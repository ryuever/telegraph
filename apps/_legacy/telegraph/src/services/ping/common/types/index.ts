export type IProcessPingMain = {
  connect: () => void
}

export type IProcessPingClient = {
  onPing: (listener: Function) => void
}
