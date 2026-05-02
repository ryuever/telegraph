import { createId } from '@x-oasis/di'

export const monitorServicePath = '/services/monitor'

export const MonitorBridgeId = createId('monitor-bridge')

export const MonitorBridgeClient = createId('monitor-bridge-client')

export const MONITOR_SNAPSHOT_CHANNEL = 'redcity:monitor-snapshot'

export const MONITOR_TOGGLE_CHANNEL = 'redcity:monitor-toggle'
