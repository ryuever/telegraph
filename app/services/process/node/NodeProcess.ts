import { Disposable } from '@x-oasis/disposable'
import type { Workbench } from '@app/services/workbench/electron-main/Workbench'

export class NodeProcess extends Disposable {
  protected workbenchClient: Workbench

  private processName: string

  constructor(processName: string, workbenchClient: Workbench) {
    super()
    this.processName = processName
    this.workbenchClient = workbenchClient
    this.registerProcessListener()
  }

  registerProcessListener() {}
}
