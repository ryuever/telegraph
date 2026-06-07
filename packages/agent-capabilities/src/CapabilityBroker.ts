import type {
  CapabilityHost,
  FeedbackAPI,
  FilesystemCapability,
  PatchCapability,
  ProcessCapability,
  ToolCapability,
} from './CapabilityHost'

export class CapabilityBroker {
  constructor(private readonly host: CapabilityHost) {}

  get feedback(): FeedbackAPI | undefined {
    return this.host.feedback
  }

  get filesystem(): FilesystemCapability | undefined {
    return this.host.filesystem
  }

  get process(): ProcessCapability | undefined {
    return this.host.process
  }

  get patch(): PatchCapability | undefined {
    return this.host.patch
  }

  registerTool(tool: ToolCapability): void {
    this.host.registerTool(tool)
  }

  getTool(name: string): ToolCapability | undefined {
    return this.host.getTool(name)
  }
}
