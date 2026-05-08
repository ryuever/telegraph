import type { MessagePortMain, UtilityProcess } from 'electron'

export enum AssignPassingPortType {
  PageletRenderer = 'pagelet-renderer',
  PageletProcess = 'pagelet-process',

  SharedProcess = 'shared-process',
  DaemonProcess = 'daemon-process',
  MainProcess = 'main-process',
}

export interface IAssignPassingPortProps {
  connectId: string
  reconnect?: boolean
}

export interface IDisconnectPassingPort {
  id: string
  type: AssignPassingPortType
}

export interface IRemovePassingPortPros {
  id: string
  type: AssignPassingPortType
}

export interface IGetChannelProps {
  id: string
  type: AssignPassingPortType
}

export interface IRemovePortProps {
  id: string
  type: AssignPassingPortType
}

export type Token = {
  key: string
  port: MessagePortMain
  targetProcess: UtilityProcess
}

export type IProcessNode = {
  assignPassingPort: (props: IAssignPassingPortProps, port: MessagePortMain) => void
  disconnectPassingPort: (connectId: string) => void

  resumeConnection: (props: { type: AssignPassingPortType }) => void
}
