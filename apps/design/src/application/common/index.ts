import { createId } from '@x-oasis/di';
import type { AgentEvent, RuntimeSettings } from '@/packages/agent-protocol';

export const DESIGN_PAGELET_SERVICE_PATH = 'design-pagelet-api';

export interface IDesignPageletService {
  info(): Promise<string>;
  ping(now: number): Promise<{ pong: number; serverTime: number }>;
  sendAgent(request: DesignAgentSendRequest): Promise<DesignAgentSendResult>;
  cancelAgent(runId: string): Promise<boolean>;
  previewArtifactPatch(request: DesignArtifactPatchRequest): Promise<DesignArtifactPatchPreviewResult>;
  applyArtifactPatch(request: DesignArtifactPatchRequest): Promise<DesignArtifactPatchApplyResult>;
  onAgentEvent(callback: (event: DesignAgentStreamEvent) => void): EventSubscription;
}

export interface EventSubscription {
  unsubscribe(): void;
}

export interface DesignAgentSendRequest {
  runId: string;
  sessionId?: string;
  prompt: string;
  settings: RuntimeSettings;
  context?: Record<string, unknown>;
}

export interface DesignAgentSendResult {
  runId: string;
  status: 'completed' | 'failed';
  error?: string;
}

export interface DesignPatchFileOperation {
  path: string;
  kind: 'add' | 'update' | 'delete';
  content?: string;
  expectedOriginal?: string;
}

export interface DesignPatchPreview {
  operations: DesignPatchFileOperation[];
  summary: {
    adds: number;
    updates: number;
    deletes: number;
  };
}

export interface DesignArtifactPatchRequest {
  runId: string;
  sessionId?: string;
  artifactId: string;
  settings: RuntimeSettings;
  operations: DesignPatchFileOperation[];
}

export interface DesignArtifactPatchPreviewResult {
  runId: string;
  artifactId: string;
  status: 'previewed' | 'failed';
  preview?: DesignPatchPreview;
  error?: string;
}

export interface DesignArtifactPatchApplyResult {
  runId: string;
  artifactId: string;
  status: 'applied' | 'failed';
  preview?: DesignPatchPreview;
  applied?: boolean;
  error?: string;
}

export type DesignAgentStreamEvent =
  | { type: 'run_queued'; runId: string; sessionId?: string }
  | { type: 'agent_event'; runId: string; sessionId?: string; event: AgentEvent }
  | { type: 'run_failed'; runId: string; sessionId?: string; error: string };

export interface IDesignApplication {
  start(): Promise<void>;
}

export const DesignApplicationId = createId('DesignApplication');
