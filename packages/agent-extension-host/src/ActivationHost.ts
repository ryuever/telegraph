import type { ActivationEvent } from './HarnessExtensionManifest'

export interface HarnessExtensionContext {
  readonly extensionId: string
}

export type HarnessExtensionActivator = (context: HarnessExtensionContext) => void | Promise<void>

export class ActivationHost {
  private readonly activators = new Map<ActivationEvent, HarnessExtensionActivator[]>()

  register(event: ActivationEvent, activator: HarnessExtensionActivator): void {
    const current = this.activators.get(event) ?? []
    current.push(activator)
    this.activators.set(event, current)
  }

  async activate(event: ActivationEvent, context: HarnessExtensionContext): Promise<void> {
    for (const activator of this.activators.get(event) ?? []) {
      await activator(context)
    }
  }
}
