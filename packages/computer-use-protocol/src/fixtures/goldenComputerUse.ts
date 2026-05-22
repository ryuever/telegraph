import { COMPUTER_USE_PROTOCOL_SCHEMA_VERSION, type ActionResult, type ComputerAction, type ComputerTarget, type Observation } from '@/packages/computer-use-protocol';

export const goldenComputerTarget: ComputerTarget = {
  targetId: 'window:design',
  kind: 'window',
  label: 'Design workspace',
  appId: 'telegraph',
  windowId: 'main',
};

export const goldenObservation: Observation = {
  observationId: 'observation-1',
  runId: 'run-1',
  target: goldenComputerTarget,
  kind: 'screenshot',
  artifactRef: {
    artifactId: 'artifact-screenshot-1',
    uri: 'telegraph://artifacts/run-1/screenshot-1.png',
    mediaType: 'image/png',
    title: 'Design workspace screenshot',
  },
  capturedAt: 1_779_465_603_000,
  schemaVersion: COMPUTER_USE_PROTOCOL_SCHEMA_VERSION,
};

export const goldenComputerAction: ComputerAction = {
  actionId: 'action-1',
  runId: 'run-1',
  target: goldenComputerTarget,
  kind: 'click',
  input: {
    x: 120,
    y: 80,
  },
  approvalId: 'approval-1',
  requestedAt: 1_779_465_604_000,
  schemaVersion: COMPUTER_USE_PROTOCOL_SCHEMA_VERSION,
};

export const goldenActionResult: ActionResult = {
  actionId: 'action-1',
  runId: 'run-1',
  ok: false,
  failureReason: 'permission_denied',
  message: 'Computer use action requires approval.',
  completedAt: 1_779_465_605_000,
  schemaVersion: COMPUTER_USE_PROTOCOL_SCHEMA_VERSION,
};
