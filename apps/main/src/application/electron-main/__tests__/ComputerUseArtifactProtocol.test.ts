import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { resolveComputerUseArtifactPath } from '@/apps/main/application/electron-main/ComputerUseArtifactProtocol';

vi.mock('electron', () => ({
  protocol: {
    handle: vi.fn(),
    registerSchemesAsPrivileged: vi.fn(),
  },
}));

describe('ComputerUseArtifactProtocol', () => {
  it('resolves computer-use artifact URLs inside the artifact root', () => {
    const root = join('/tmp', 'telegraph-artifacts');

    expect(resolveComputerUseArtifactPath(
      'telegraph://computer-use-artifacts/run-1/shot.png',
      root
    )).toEqual({
      path: join(root, 'run-1', 'shot.png'),
    });
  });

  it('rejects path traversal and unrelated telegraph URLs', () => {
    const root = join('/tmp', 'telegraph-artifacts');

    expect(resolveComputerUseArtifactPath(
      'telegraph://computer-use-artifacts/run-1/%2E%2E/secret.txt',
      root
    )).toBeNull();
    expect(resolveComputerUseArtifactPath(
      'telegraph://other-host/run-1/shot.png',
      root
    )).toBeNull();
    expect(resolveComputerUseArtifactPath(
      'telegraph://computer-use-artifacts/run-1/%E0%A4%A',
      root
    )).toBeNull();
  });
});
