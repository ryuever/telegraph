/**
 * Unit tests for ExtensionRegistry
 */

import assert from 'assert';
import { describe, it, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ExtensionRegistry } from './ExtensionRegistry';
import { ToolRegistry } from '../../runtime/toolExecution/ToolRegistry';
import type { ExtensionManifest } from '../ExtensionManifest';

describe('ExtensionRegistry', () => {
  let tempDir: string;
  let toolRegistry: ToolRegistry;
  let extensionRegistry: ExtensionRegistry;

  beforeEach(() => {
    // Create temp directory for test fixtures
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-test-'));
    toolRegistry = new ToolRegistry();
    extensionRegistry = new ExtensionRegistry(toolRegistry);
  });

  it('should load extension from JSON manifest', async () => {
    const extensionDir = path.join(tempDir, 'my-tools');
    fs.mkdirSync(extensionDir);

    const manifest: ExtensionManifest = {
      name: 'my-tools',
      version: '1.0.0',
      description: 'Sample tools',
      author: 'test@example.com',
      tools: [
        {
          id: 'http-tool',
          name: 'HTTP Tool',
          description: 'Fetch from HTTP',
          inputSchema: {
            type: 'object',
            properties: { url: { type: 'string' } },
            required: ['url']
          },
          executable: {
            type: 'http',
            endpoint: 'http://localhost:3000/fetch'
          }
        }
      ]
    };

    const manifestPath = path.join(extensionDir, 'extension.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    await extensionRegistry.loadExtensionFromPath(manifestPath);

    const loaded = extensionRegistry.getExtension('my-tools');
    assert.ok(loaded);
    assert.strictEqual(loaded.manifest.name, 'my-tools');
    assert.strictEqual(loaded.tools.size, 1);
  });

  it('should register tools from extension', async () => {
    const extensionDir = path.join(tempDir, 'tools');
    fs.mkdirSync(extensionDir);

    const manifest: ExtensionManifest = {
      name: 'test-ext',
      version: '1.0.0',
      description: 'Test',
      author: 'test@example.com',
      tools: [
        {
          id: 'tool-1',
          name: 'Tool 1',
          description: 'First tool',
          inputSchema: { type: 'object' },
          executable: { type: 'http', endpoint: 'http://localhost:3000' }
        },
        {
          id: 'tool-2',
          name: 'Tool 2',
          description: 'Second tool',
          inputSchema: { type: 'object' },
          executable: { type: 'http', endpoint: 'http://localhost:3000' }
        }
      ]
    };

    const manifestPath = path.join(extensionDir, 'extension.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    await extensionRegistry.loadExtensionFromPath(manifestPath);

    // Check both tools are registered
    assert.ok(toolRegistry.get('tool-1'));
    assert.ok(toolRegistry.get('tool-2'));
  });

  it('should reject invalid manifest', async () => {
    const extensionDir = path.join(tempDir, 'invalid');
    fs.mkdirSync(extensionDir);

    const invalidManifest = {
      // missing required fields
      name: 'invalid',
      tools: []
    };

    const manifestPath = path.join(extensionDir, 'extension.json');
    fs.writeFileSync(manifestPath, JSON.stringify(invalidManifest, null, 2));

    await assert.rejects(
      () => extensionRegistry.loadExtensionFromPath(manifestPath),
      /Invalid manifest/
    );
  });

  it('should unload extension and unregister tools', async () => {
    const extensionDir = path.join(tempDir, 'tools');
    fs.mkdirSync(extensionDir);

    const manifest: ExtensionManifest = {
      name: 'unload-test',
      version: '1.0.0',
      description: 'Test',
      author: 'test@example.com',
      tools: [
        {
          id: 'removable-tool',
          name: 'Removable',
          description: 'Will be removed',
          inputSchema: { type: 'object' },
          executable: { type: 'http', endpoint: 'http://localhost:3000' }
        }
      ]
    };

    const manifestPath = path.join(extensionDir, 'extension.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    await extensionRegistry.loadExtensionFromPath(manifestPath);
    assert.ok(toolRegistry.get('removable-tool'));

    // Unload
    await extensionRegistry.unloadExtension('unload-test');

    // Tool should be gone
    assert.strictEqual(toolRegistry.get('removable-tool'), undefined);
  });

  it('should support tool dependencies in manifest', async () => {
    const extensionDir = path.join(tempDir, 'deps');
    fs.mkdirSync(extensionDir);

    const manifest: ExtensionManifest = {
      name: 'dep-test',
      version: '1.0.0',
      description: 'Dependency test',
      author: 'test@example.com',
      tools: [
        {
          id: 'fetch-tool',
          name: 'Fetch',
          description: 'Fetches data',
          inputSchema: { type: 'object' },
          executable: { type: 'http', endpoint: 'http://localhost:3000/fetch' }
        },
        {
          id: 'process-tool',
          name: 'Process',
          description: 'Processes fetched data',
          inputSchema: { type: 'object' },
          executable: { type: 'http', endpoint: 'http://localhost:3000/process' },
          dependencies: ['fetch-tool']
        }
      ]
    };

    const manifestPath = path.join(extensionDir, 'extension.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    await extensionRegistry.loadExtensionFromPath(manifestPath);

    const loaded = extensionRegistry.getExtension('dep-test');
    assert.ok(loaded);

    // Both tools should be loaded
    assert.strictEqual(loaded.tools.size, 2);
  });

  it('should get all tools from all extensions', async () => {
    // Load first extension
    const ext1Dir = path.join(tempDir, 'ext1');
    fs.mkdirSync(ext1Dir);
    const manifest1: ExtensionManifest = {
      name: 'ext1',
      version: '1.0.0',
      description: 'Extension 1',
      author: 'test@example.com',
      tools: [
        {
          id: 'tool-1a',
          name: 'Tool 1A',
          description: 'Test',
          inputSchema: { type: 'object' },
          executable: { type: 'http', endpoint: 'http://localhost:3000' }
        }
      ]
    };
    const manifestPath1 = path.join(ext1Dir, 'extension.json');
    fs.writeFileSync(manifestPath1, JSON.stringify(manifest1, null, 2));
    await extensionRegistry.loadExtensionFromPath(manifestPath1);

    // Load second extension
    const ext2Dir = path.join(tempDir, 'ext2');
    fs.mkdirSync(ext2Dir);
    const manifest2: ExtensionManifest = {
      name: 'ext2',
      version: '1.0.0',
      description: 'Extension 2',
      author: 'test@example.com',
      tools: [
        {
          id: 'tool-2a',
          name: 'Tool 2A',
          description: 'Test',
          inputSchema: { type: 'object' },
          executable: { type: 'http', endpoint: 'http://localhost:3000' }
        },
        {
          id: 'tool-2b',
          name: 'Tool 2B',
          description: 'Test',
          inputSchema: { type: 'object' },
          executable: { type: 'http', endpoint: 'http://localhost:3000' }
        }
      ]
    };
    const manifestPath2 = path.join(ext2Dir, 'extension.json');
    fs.writeFileSync(manifestPath2, JSON.stringify(manifest2, null, 2));
    await extensionRegistry.loadExtensionFromPath(manifestPath2);

    // Get all tools
    const allTools = extensionRegistry.getAllTools();
    assert.strictEqual(allTools.length, 3);
    assert.strictEqual(allTools.some((t: any) => t.id === 'tool-1a'), true);
    assert.strictEqual(allTools.some((t: any) => t.id === 'tool-2a'), true);
    assert.strictEqual(allTools.some((t: any) => t.id === 'tool-2b'), true);
  });

  it('should handle retry policy configuration', async () => {
    const extensionDir = path.join(tempDir, 'retry');
    fs.mkdirSync(extensionDir);

    const manifest: ExtensionManifest = {
      name: 'retry-test',
      version: '1.0.0',
      description: 'Retry test',
      author: 'test@example.com',
      tools: [
        {
          id: 'retry-tool',
          name: 'Retry Tool',
          description: 'Tool with retry',
          inputSchema: { type: 'object' },
          executable: { type: 'http', endpoint: 'http://localhost:3000' },
          retryPolicy: {
            maxAttempts: 3,
            backoffMs: 500
          },
          timeout: 10000
        }
      ]
    };

    const manifestPath = path.join(extensionDir, 'extension.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    await extensionRegistry.loadExtensionFromPath(manifestPath);

    const loaded = extensionRegistry.getExtension('retry-test');
    assert.ok(loaded);
    assert.strictEqual(loaded.tools.size, 1);
  });
});
