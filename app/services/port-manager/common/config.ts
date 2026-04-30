import { createId } from '@x-oasis/di'

export const acquirePortMainServicePath = '/services/acquire-port-main'
export const AcquirePortMainClient = createId('acquire-port-main-client')

/** 注意区分，这个是 MessageChannelPort 使用到的；是建联以后的channel，开发者基本上是
 * 使用这个的，别把path 跟上面搞混了。。。
 */

export const MainProcessPortClient = createId('mainProcessPortClient')
export const mainProcessPortServicePath = '/services/main-process-port'

export const SharedProcessPortClient = createId('sharedProcessPortClient')
export const sharedProcessPortServicePath = '/services/shared-process-port'

export const DaemonProcessPortClient = createId('daemonProcessPortClient')
export const daemonProcessPortServicePath = '/services/daemon-process-port'

export const PageletProcessPortClient = createId('pageletProcessPortClient')
export const pageletProcessPortServicePath = '/services/pagelet-process-port'

export const PageletClientChannelClient = createId('pagelet-client-channel')
export const pageletClintChannelServicePath = '/services/pagelet-client-channel'
