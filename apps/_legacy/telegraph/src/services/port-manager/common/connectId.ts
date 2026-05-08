import type { AssignPassingPortType } from '@telegraph/services/process/common/types'

/**
 * fromId: 发起连接方的唯一ID，一个进程有一个唯一ID
 * fromType: 发起连接方的类型
 * toType: 目标方的类型
 * @param option
 */
export function createConnectId(option: {
  fromId: string
  fromType: AssignPassingPortType
  toType: AssignPassingPortType
}) {
  const { fromId, fromType, toType } = option
  return `${fromId}:${fromType}:${toType}`
}

export function parseConnectId(connectId: string) {
  const arr = connectId.split(':')
  return {
    fromId: arr[0],
    fromType: arr[1] as AssignPassingPortType,
    toType: arr[2] as AssignPassingPortType,
  }
}
