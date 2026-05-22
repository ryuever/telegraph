import type { COMPUTER_USE_PROTOCOL_SCHEMA_VERSION } from './schema.js';
import type { ComputerTarget } from './target.js';

export type ObservationKind = 'screenshot' | 'window_list' | 'accessibility_tree' | 'ocr_text';

export interface ObservationArtifactRef {
  artifactId: string;
  uri: string;
  mediaType: string;
  title?: string;
  sizeBytes?: number;
  sha256?: string;
}

export interface Observation {
  observationId: string;
  runId?: string;
  target: ComputerTarget;
  kind: ObservationKind;
  artifactRef: ObservationArtifactRef;
  capturedAt: number;
  redactions?: string[];
  schemaVersion: typeof COMPUTER_USE_PROTOCOL_SCHEMA_VERSION;
}
