import { describe, expect, it } from 'vitest';

import {
  evaluateDomainNetworkPolicy,
  selectExecutionTarget,
  validateExecutionTargetDefinition,
  type ExecutionTargetDefinition,
} from '@/packages/computer-use-protocol';

const artifactTransfer = {
  exportMode: 'explicit-approval',
  importMode: 'explicit-approval',
} as const;

const desktop: ExecutionTargetDefinition = {
  target: { targetId: 'desktop-1', kind: 'desktop', label: 'Real Desktop' },
  trustLevel: 'user-desktop',
  networkPolicy: { mode: 'restricted' },
  profileSync: { mode: 'none', homeMount: 'none' },
  artifactTransfer,
};

const isolatedBrowser: ExecutionTargetDefinition = {
  target: { targetId: 'iso-browser-1', kind: 'isolated_browser', label: 'Isolated Browser' },
  trustLevel: 'ephemeral-isolated',
  persistent: false,
  networkPolicy: { mode: 'allowlist', allowedDomains: ['example.com', '*.docs.test'] },
  profileSync: { mode: 'bookmarks-only', homeMount: 'none' },
  artifactTransfer,
};

const vm: ExecutionTargetDefinition = {
  target: { targetId: 'vm-1', kind: 'vm', label: 'Managed VM' },
  trustLevel: 'managed-vm',
  networkPolicy: { mode: 'allowlist', allowedDomains: ['example.com'] },
  profileSync: { mode: 'managed-profile', homeMount: 'none' },
  artifactTransfer,
};

describe('isolation target policy', () => {
  it('selects isolated browser for internet automation when domain policy allows it', () => {
    const result = selectExecutionTarget([desktop, isolatedBrowser, vm], {
      internetAutomation: true,
      domains: ['https://docs.test/page'],
    });

    expect(result.target?.target.targetId).toBe('iso-browser-1');
  });

  it('selects real desktop when task requires local state', () => {
    const result = selectExecutionTarget([desktop, isolatedBrowser, vm], {
      requiresLocalState: true,
      domains: ['internal.local'],
    });

    expect(result.target?.target.targetId).toBe('desktop-1');
  });

  it('rejects targets whose allowlist does not cover the domain', () => {
    const result = selectExecutionTarget([isolatedBrowser, vm], {
      internetAutomation: true,
      domains: ['bank.example'],
    });

    expect(result.target).toBeNull();
    expect(result.rejected.map(item => item.reason)).toContain('domain not allowlisted: bank.example');
  });

  it('evaluates wildcard and blocked domain policies', () => {
    expect(evaluateDomainNetworkPolicy(
      { mode: 'allowlist', allowedDomains: ['*.example.com'], blockedDomains: ['admin.example.com'] },
      'docs.example.com',
    ).allowed).toBe(true);
    expect(evaluateDomainNetworkPolicy(
      { mode: 'allowlist', allowedDomains: ['*.example.com'], blockedDomains: ['admin.example.com'] },
      'admin.example.com',
    ).allowed).toBe(false);
  });

  it('rejects profile sync modes outside the restricted protocol set', () => {
    expect(validateExecutionTargetDefinition({
      ...vm,
      profileSync: { mode: 'primary-browser-profile' as 'managed-profile', homeMount: 'none' },
    })).toContain('invalid profile sync mode: primary-browser-profile');
  });
});
