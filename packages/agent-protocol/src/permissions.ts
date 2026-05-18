/** Declarative permission requests (extension manifest + runtime prompts). */
export type PermissionRequest =
  | { type: 'filesystem'; scope: 'workspace' | 'user-selected' | 'home' | 'any'; access: 'read' | 'write' | 'readwrite' }
  | { type: 'process'; commands?: string[] }
  | { type: 'network'; hosts?: string[] }
  | { type: 'shell'; risk: 'low' | 'medium' | 'high' }
  | { type: 'secrets'; keys?: string[] }
