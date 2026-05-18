import { createId } from '@x-oasis/di';
import type { AgentEvent, RuntimeSettings } from '@/packages/agent-protocol';

export const DESIGN_PAGELET_SERVICE_PATH = 'design-pagelet-api';

export interface IDesignPageletService {
  info(): Promise<string>;
  ping(now: number): Promise<{ pong: number; serverTime: number }>;
  sendAgent(request: DesignAgentSendRequest): Promise<DesignAgentSendResult>;
  cancelAgent(runId: string): Promise<boolean>;
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

export type DesignAgentStreamEvent =
  | { type: 'run_queued'; runId: string; sessionId?: string }
  | { type: 'agent_event'; runId: string; sessionId?: string; event: AgentEvent }
  | { type: 'run_failed'; runId: string; sessionId?: string; error: string };

export interface IDesignApplication {
  start(): Promise<void>;
}

export const DesignApplicationId = createId('DesignApplication');
