import type { ComputerTarget, ComputerTargetKind } from './target.js';

export type ExecutionTargetTrustLevel = 'user-desktop' | 'ephemeral-isolated' | 'managed-vm';

export type NetworkPolicyMode = 'offline' | 'allowlist' | 'restricted' | 'open';

export interface DomainNetworkPolicy {
  mode: NetworkPolicyMode;
  allowedDomains?: string[];
  blockedDomains?: string[];
  allowPrivateNetwork?: boolean;
}

export type ProfileSyncMode =
  | 'none'
  | 'bookmarks-only'
  | 'selected-cookies'
  | 'managed-profile';

export type HomeMountPolicy = 'none' | 'selected-paths-readonly' | 'selected-paths-readwrite';

export interface ProfileSyncPolicy {
  mode: ProfileSyncMode;
  allowedCookieDomains?: string[];
  homeMount?: HomeMountPolicy;
}

export type ArtifactTransferMode = 'none' | 'explicit-approval' | 'workspace-scoped';

export interface ArtifactTransferPolicy {
  exportMode: ArtifactTransferMode;
  importMode: ArtifactTransferMode;
  allowedMediaTypes?: string[];
}

export interface ExecutionTargetDefinition {
  target: ComputerTarget;
  trustLevel: ExecutionTargetTrustLevel;
  providerId?: string;
  enabled?: boolean;
  persistent?: boolean;
  priority?: number;
  networkPolicy: DomainNetworkPolicy;
  profileSync: ProfileSyncPolicy;
  artifactTransfer: ArtifactTransferPolicy;
  metadata?: Record<string, unknown>;
}

export interface TargetSelectionRequest {
  requestedKind?: ComputerTargetKind;
  requiresLocalState?: boolean;
  internetAutomation?: boolean;
  domains?: string[];
}

export interface TargetSelectionResult {
  target: ExecutionTargetDefinition | null;
  rejected: Array<{ targetId: string; reason: string }>;
}

export function selectExecutionTarget(
  targets: ExecutionTargetDefinition[],
  request: TargetSelectionRequest,
): TargetSelectionResult {
  const rejected: Array<{ targetId: string; reason: string }> = [];
  const candidates = targets
    .filter(definition => {
      const errors = validateExecutionTargetDefinition(definition);
      if (errors.length > 0) {
        rejected.push({ targetId: definition.target.targetId, reason: errors.join('; ') });
        return false;
      }
      if (definition.enabled === false) {
        rejected.push({ targetId: definition.target.targetId, reason: 'target disabled' });
        return false;
      }
      if (request.requestedKind && definition.target.kind !== request.requestedKind) {
        rejected.push({ targetId: definition.target.targetId, reason: `kind mismatch: ${definition.target.kind}` });
        return false;
      }
      for (const domain of request.domains ?? []) {
        const decision = evaluateDomainNetworkPolicy(definition.networkPolicy, domain);
        if (!decision.allowed) {
          rejected.push({ targetId: definition.target.targetId, reason: decision.reason });
          return false;
        }
      }
      return true;
    })
    .sort((left, right) => scoreTarget(right, request) - scoreTarget(left, request));

  return { target: candidates[0] ?? null, rejected };
}

export function evaluateDomainNetworkPolicy(
  policy: DomainNetworkPolicy,
  domain: string,
): { allowed: boolean; reason: string } {
  const normalizedDomain = normalizeDomain(domain);
  if (policy.blockedDomains?.some(item => domainMatches(normalizedDomain, item))) {
    return { allowed: false, reason: `domain blocked: ${normalizedDomain}` };
  }

  switch (policy.mode) {
    case 'offline':
      return { allowed: false, reason: 'network offline' };
    case 'allowlist':
      if (policy.allowedDomains?.some(item => domainMatches(normalizedDomain, item))) {
        return { allowed: true, reason: 'domain allowed' };
      }
      return { allowed: false, reason: `domain not allowlisted: ${normalizedDomain}` };
    case 'restricted':
    case 'open':
      return { allowed: true, reason: 'domain allowed' };
    default:
      return { allowed: false, reason: `unknown network policy: ${String(policy.mode)}` };
  }
}

export function validateExecutionTargetDefinition(definition: ExecutionTargetDefinition): string[] {
  const errors: string[] = [];
  if (!definition.target?.targetId) errors.push('target.targetId is required');
  if (!definition.target?.kind) errors.push('target.kind is required');
  if (!['user-desktop', 'ephemeral-isolated', 'managed-vm'].includes(definition.trustLevel)) {
    errors.push(`invalid trustLevel: ${String(definition.trustLevel)}`);
  }
  if (!['offline', 'allowlist', 'restricted', 'open'].includes(definition.networkPolicy.mode)) {
    errors.push(`invalid network policy mode: ${String(definition.networkPolicy.mode)}`);
  }
  if (!['none', 'bookmarks-only', 'selected-cookies', 'managed-profile'].includes(definition.profileSync.mode)) {
    errors.push(`invalid profile sync mode: ${String(definition.profileSync.mode)}`);
  }
  if (
    definition.profileSync.homeMount &&
    !['none', 'selected-paths-readonly', 'selected-paths-readwrite'].includes(definition.profileSync.homeMount)
  ) {
    errors.push(`invalid home mount policy: ${String(definition.profileSync.homeMount)}`);
  }
  return errors;
}

function scoreTarget(definition: ExecutionTargetDefinition, request: TargetSelectionRequest): number {
  let score = definition.priority ?? 0;
  const kind = definition.target.kind;
  if (request.requiresLocalState && ['desktop', 'app', 'window', 'browser_tab'].includes(kind)) score += 100;
  if (request.internetAutomation && kind === 'isolated_browser') score += 100;
  if (request.internetAutomation && kind === 'vm') score += 80;
  if (!request.requiresLocalState && ['desktop', 'app', 'window'].includes(kind)) score -= 25;
  if (definition.networkPolicy.mode === 'allowlist') score += 5;
  if (definition.persistent === false) score += 3;
  return score;
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0] ?? '';
}

function domainMatches(domain: string, pattern: string): boolean {
  const normalizedPattern = normalizeDomain(pattern);
  if (normalizedPattern.startsWith('*.')) {
    const suffix = normalizedPattern.slice(1);
    return domain.endsWith(suffix) || domain === normalizedPattern.slice(2);
  }
  return domain === normalizedPattern || domain.endsWith(`.${normalizedPattern}`);
}
