import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  RELAY_PACKAGE_SCHEMA_VERSION,
  assertEnterpriseSelfHostRelayPackageManifest,
  createEnterpriseSelfHostRelayPackageManifest,
} from '@/packages/relay-protocol';

const __dirname = dirname(fileURLToPath(import.meta.url));
const relayBin = resolve(__dirname, '../../bin/telegraph-self-host-relay.mjs');

describe('enterprise self-host relay packaging', () => {
  it('creates a routing-only package manifest with stdio packaging metadata', () => {
    const manifest = createEnterpriseSelfHostRelayPackageManifest();

    expect(manifest).toMatchObject({
      schemaVersion: RELAY_PACKAGE_SCHEMA_VERSION,
      packageId: '@telegraph/self-host-relay',
      boundaryPolicy: {
        deploymentMode: 'self-host',
        localOnlySecrets: true,
        storesDesktopExecutionCapability: false,
      },
      retention: {
        persistPayloads: true,
      },
    });
    expect(manifest.entrypoints.some(entrypoint => entrypoint.kind === 'stdio-jsonl')).toBe(true);
    expect(() => {
      assertEnterpriseSelfHostRelayPackageManifest(manifest);
    }).not.toThrow();
  });

  it('rejects cloud or non-stdio packaging for enterprise self-host relay', () => {
    expect(() => createEnterpriseSelfHostRelayPackageManifest({
      boundaryPolicy: {
        deploymentMode: 'cloud',
        localOnlySecrets: false,
        storesDesktopExecutionCapability: false,
        allowedPayloadKinds: ['external_message'],
      },
    })).toThrow('Enterprise self-host relay package must use self-host deployment boundary.');

    expect(() => createEnterpriseSelfHostRelayPackageManifest({
      entrypoints: [{
        kind: 'http-json',
        command: 'telegraph-self-host-relay',
        args: ['serve', '--http'],
      }],
    })).toThrow('Enterprise self-host relay package requires a stdio-jsonl entrypoint.');
  });

  it('runs the packaged stdio relay as a routing-only JSONL process', async () => {
    const messages = await runRelayStdio([
      { id: 1, method: 'registerParticipant', params: { participantId: 'desktop-1', role: 'desktop', now: 10 } },
      { id: 2, method: 'registerParticipant', params: { participantId: 'adapter-1', role: 'channel-adapter', now: 10 } },
      {
        id: 3,
        method: 'publish',
        params: {
          from: 'adapter-1',
          to: 'desktop-1',
          now: 20,
          payload: {
            kind: 'external_message',
            message: {
              messageId: 'msg-1',
              actor: { actorId: 'telegram:ada', kind: 'telegram' },
              channel: { kind: 'telegram', channelId: 'telegram:chat' },
              text: 'build',
              receivedAt: 20,
              schemaVersion: 1,
            },
          },
        },
      },
      { id: 4, method: 'list', params: { participantId: 'desktop-1' } },
    ]);

    expect(messages.map(message => message.ok)).toEqual([true, true, true, true]);
    expect(messages[2]?.result).toMatchObject({
      envelopeId: 'relay-1',
      cursor: 1,
      from: 'adapter-1',
      to: 'desktop-1',
    });
    expect(messages[3]?.result).toEqual([messages[2]?.result]);
  });
});

function runRelayStdio(requests: unknown[]): Promise<Array<{ ok: boolean; result?: unknown; error?: string }>> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [relayBin, 'serve', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const messages: Array<{ ok: boolean; result?: unknown; error?: string }> = [];
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += String(chunk);
      const lines = stdout.split('\n');
      stdout = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        messages.push(JSON.parse(line) as { ok: boolean; result?: unknown; error?: string });
      }
      if (messages.length === requests.length) {
        child.stdin.end();
      }
    });
    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) {
        reject(new Error(`relay exited with ${String(code)}: ${stderr}`));
        return;
      }
      resolvePromise(messages);
    });

    for (const request of requests) {
      child.stdin.write(`${JSON.stringify(request)}\n`);
    }
  });
}
