import { createId } from '@x-oasis/di';
import type { AgentEvent, RuntimeSettings } from '@/packages/agent-protocol';

export const DESIGN_PAGELET_SERVICE_PATH = 'design-pagelet-api';

export interface IDesignPageletService {
  info(): Promise<string>;
  ping(now: number): Promise<{ pong: number; serverTime: number }>;
  sendAgent(request: DesignAgentSendRequest): Promise<DesignAgentSendResult>;
  cancelAgent(runId: string): Promise<boolean>;
  listAgentRuns(): Promise<DesignAgentRunRecordSnapshot[]>;
  getAgentRun(runId: string): Promise<DesignAgentRunRecordSnapshot | null>;
  listSubagents(): Promise<DesignSubagentRecordSnapshot[]>;
  getSubagentResult(childRunId: string, consume?: boolean): Promise<DesignSubagentRecordSnapshot | null>;
  cancelSubagent(childRunId: string): Promise<boolean>;
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

export interface DesignAgentRunRecordSnapshot {
  runId: string;
  sessionId?: string;
  prompt: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
  events: DesignAgentRunEventSnapshot[];
}

export interface DesignAgentRunEventSnapshot {
  type: AgentEvent['type'] | DesignAgentStreamEvent['type'];
  ts: number;
  label?: string;
}

export interface DesignSubagentRecordSnapshot {
  id: string;
  parentRunId: string;
  sessionId?: string;
  agent: string;
  label: string;
  description: string;
  task: string;
  status: 'queued' | 'running' | 'completed' | 'stopped' | 'error';
  result?: string;
  error?: string;
  toolUses: number;
  startedAt: number;
  completedAt?: number;
  resultConsumed?: boolean;
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

export interface DesignSelectedComponentSnapshot {
  id: string;
  artifactId: string;
  label: string;
  source: 'patch-operation' | 'preview-dom' | 'preview-placeholder';
  path?: string;
  operationKind?: DesignPatchFileOperation['kind'];
  elementTag?: string;
  className?: string;
  attributes?: Record<string, string>;
  sourceLocation?: {
    filePath: string;
    line: number;
    column: number;
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
  | { type: 'subagent_updated'; runId: string; sessionId?: string; subagent: DesignSubagentRecordSnapshot }
  | { type: 'run_failed'; runId: string; sessionId?: string; error: string };

export interface IDesignApplication {
  start(): Promise<void>;
}

export const DesignApplicationId = createId('DesignApplication');
