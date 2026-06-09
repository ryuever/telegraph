import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getPiAiProviderConfig,
  getPiAiRuntimeConfig,
  upsertPiAiProviderConfig,
} from '../pi-ai-provider-service';

let tempDir = '';

describe('pi-ai provider service project env handling', () => {
  let previousWorkspaceRoot: string | undefined;
  let previousEnvKey: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'telegraph-setting-env-'));
    previousWorkspaceRoot = process.env.TELEGRAPH_WORKSPACE_ROOT;
    previousEnvKey = process.env.ZAI_API_KEY;
    process.env.TELEGRAPH_WORKSPACE_ROOT = tempDir;
    delete process.env.ZAI_API_KEY;
    writeFileSync(join(tempDir, '.env.local'), [
      `TELEGRAPH_AGENT_RUNTIME=${JSON.stringify({ provider: 'zai', modelId: 'glm-5.1', authMode: 'api-key' })}`,
      `TELEGRAPH_AGENT_PROVIDERS=${JSON.stringify({
        zai: {
          name: 'ZAI',
          baseUrl: 'https://api.z.ai/api/coding/paas/v4',
          api: 'openai-completions',
          apiKeyEnv: 'ZAI_API_KEY',
          models: [{ id: 'glm-5.1', name: 'GLM-5.1' }],
        },
      })}`,
      '',
    ].join('\n'), 'utf-8');
  });

  afterEach(() => {
    if (previousWorkspaceRoot === undefined) {
      delete process.env.TELEGRAPH_WORKSPACE_ROOT;
    } else {
      process.env.TELEGRAPH_WORKSPACE_ROOT = previousWorkspaceRoot;
    }
    if (previousEnvKey === undefined) {
      delete process.env.ZAI_API_KEY;
    } else {
      process.env.ZAI_API_KEY = previousEnvKey;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns env-backed api keys as an empty editable secret field', () => {
    const config = getPiAiProviderConfig('zai');

    expect(config.apiKey).toBe('');
    expect(config.apiKeyEnvName).toBe('ZAI_API_KEY');
    expect(config.modelId).toBe('glm-5.1');
    expect(config.modelLabel).toBe('GLM-5.1');
  });

  it('returns the selected runtime provider from project .env.local', () => {
    const config = getPiAiRuntimeConfig();

    expect(config.provider).toBe('zai');
    expect(config.modelId).toBe('glm-5.1');
    expect(config.apiKeyEnvName).toBe('ZAI_API_KEY');
  });

  it('writes env-backed api keys to project .env.local and keeps object config fields', async () => {
    await upsertPiAiProviderConfig({
      provider: 'zai',
      modelId: 'glm-5.1',
      modelLabel: 'GLM-5.1',
      apiKey: 'real-zai-key',
      apiKeyEnvName: 'ZAI_API_KEY',
    });

    const content = readFileSync(join(tempDir, '.env.local'), 'utf-8');
    expect(content).toContain('ZAI_API_KEY=real-zai-key');
    expect(content).toContain('TELEGRAPH_AGENT_RUNTIME=');
    expect(content).toContain('TELEGRAPH_AGENT_PROVIDERS=');
    expect(content).not.toContain('TELEGRAPH_AGENT_API_KEY_ENV=');
    expect(process.env.ZAI_API_KEY).toBe('real-zai-key');
  });

  it('updates an existing project .env.local key', async () => {
    writeFileSync(join(tempDir, '.env.local'), 'ZAI_API_KEY=old-key\nOTHER=value\n', 'utf-8');

    await upsertPiAiProviderConfig({
      provider: 'zai',
      apiKey: 'new-key',
      apiKeyEnvName: 'ZAI_API_KEY',
    });

    const content = readFileSync(join(tempDir, '.env.local'), 'utf-8');
    expect(content).toContain('ZAI_API_KEY=new-key');
    expect(content).toContain('OTHER=value');
    expect(existsSync(join(tempDir, '.env'))).toBe(false);
  });
});
