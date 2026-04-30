import { createId } from '@x-oasis/di'

export const servicePath = '/services/diagnostics'
export const Handler = Symbol(servicePath)
export const DiagnosticsClient = createId('diagnostics-client')
