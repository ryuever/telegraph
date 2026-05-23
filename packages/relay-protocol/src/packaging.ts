import {
  RELAY_PROTOCOL_SCHEMA_VERSION,
  assertRoutingOnlyRelayPolicy,
  deploymentBoundary,
  type RelayBoundaryPolicy,
} from '@/packages/relay-protocol';

export const RELAY_PACKAGE_SCHEMA_VERSION = 1;

export type RelayRuntimeEntrypointKind = 'stdio-jsonl' | 'http-json';

export interface RelayRuntimeEntrypoint {
  kind: RelayRuntimeEntrypointKind;
  command?: string;
  args?: string[];
  portEnv?: string;
  healthPath?: string;
  readinessPath?: string;
}

export interface RelayRequiredEnvironmentVariable {
  name: string;
  description: string;
  secret: boolean;
}

export interface RelayRetentionPolicy {
  maxEnvelopeAgeMs: number;
  maxEnvelopesPerParticipant: number;
  persistPayloads: boolean;
}

export interface EnterpriseSelfHostRelayPackageManifest {
  schemaVersion: number;
  packageId: string;
  title: string;
  protocolSchemaVersion: number;
  boundaryPolicy: RelayBoundaryPolicy;
  entrypoints: RelayRuntimeEntrypoint[];
  requiredEnvironment: RelayRequiredEnvironmentVariable[];
  retention: RelayRetentionPolicy;
}

export function createEnterpriseSelfHostRelayPackageManifest(
  input: Partial<Omit<EnterpriseSelfHostRelayPackageManifest, 'schemaVersion' | 'protocolSchemaVersion' | 'boundaryPolicy'>> & {
    boundaryPolicy?: RelayBoundaryPolicy;
  } = {},
): EnterpriseSelfHostRelayPackageManifest {
  const manifest: EnterpriseSelfHostRelayPackageManifest = {
    schemaVersion: RELAY_PACKAGE_SCHEMA_VERSION,
    packageId: input.packageId ?? '@telegraph/self-host-relay',
    title: input.title ?? 'Telegraph Enterprise Self-Host Relay',
    protocolSchemaVersion: RELAY_PROTOCOL_SCHEMA_VERSION,
    boundaryPolicy: input.boundaryPolicy ?? deploymentBoundary('self-host'),
    entrypoints: input.entrypoints ?? [
      {
        kind: 'stdio-jsonl',
        command: 'telegraph-self-host-relay',
        args: ['serve', '--stdio'],
      },
      {
        kind: 'http-json',
        command: 'telegraph-self-host-relay',
        args: ['serve', '--http'],
        portEnv: 'TELEGRAPH_RELAY_PORT',
        healthPath: '/healthz',
        readinessPath: '/readyz',
      },
    ],
    requiredEnvironment: input.requiredEnvironment ?? [
      {
        name: 'TELEGRAPH_RELAY_OPERATOR_TOKEN',
        description: 'Local-only operator token used to administer participant registration.',
        secret: true,
      },
      {
        name: 'TELEGRAPH_RELAY_STORAGE_DIR',
        description: 'Directory for envelope queue persistence and audit metadata.',
        secret: false,
      },
    ],
    retention: input.retention ?? {
      maxEnvelopeAgeMs: 7 * 24 * 60 * 60_000,
      maxEnvelopesPerParticipant: 10_000,
      persistPayloads: true,
    },
  };
  assertEnterpriseSelfHostRelayPackageManifest(manifest);
  return manifest;
}

export function assertEnterpriseSelfHostRelayPackageManifest(
  manifest: EnterpriseSelfHostRelayPackageManifest,
): void {
  if (manifest.schemaVersion !== RELAY_PACKAGE_SCHEMA_VERSION) {
    throw new Error(`Unsupported relay package schema version: ${String(manifest.schemaVersion)}`);
  }
  if (manifest.protocolSchemaVersion !== RELAY_PROTOCOL_SCHEMA_VERSION) {
    throw new Error(`Unsupported relay protocol schema version: ${String(manifest.protocolSchemaVersion)}`);
  }
  if (manifest.boundaryPolicy.deploymentMode !== 'self-host') {
    throw new Error('Enterprise self-host relay package must use self-host deployment boundary.');
  }
  assertRoutingOnlyRelayPolicy(manifest.boundaryPolicy);
  if (manifest.entrypoints.length === 0) {
    throw new Error('Enterprise self-host relay package requires at least one runtime entrypoint.');
  }
  if (!manifest.entrypoints.some(entrypoint => entrypoint.kind === 'stdio-jsonl')) {
    throw new Error('Enterprise self-host relay package requires a stdio-jsonl entrypoint.');
  }
  const envNames = new Set<string>();
  for (const env of manifest.requiredEnvironment) {
    if (envNames.has(env.name)) {
      throw new Error(`Duplicate relay package environment variable: ${env.name}`);
    }
    envNames.add(env.name);
  }
  if (manifest.retention.maxEnvelopeAgeMs <= 0) {
    throw new Error('Relay retention maxEnvelopeAgeMs must be positive.');
  }
  if (manifest.retention.maxEnvelopesPerParticipant <= 0) {
    throw new Error('Relay retention maxEnvelopesPerParticipant must be positive.');
  }
}
