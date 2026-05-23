/**
 * Unit tests for ExtensionManifest validation
 */

import assert from 'assert';
import { describe, it } from 'vitest';
import {
  validateManifest,
  assertValidManifest,
  type ExtensionManifest
} from '../ExtensionManifest';

describe('ExtensionManifest', () => {
  describe('validateManifest', () => {
    it('should accept valid manifest', () => {
      const manifest: ExtensionManifest = {
        name: 'my-tools',
        version: '1.0.0',
        description: 'Sample tools',
        author: 'user@example.com',
        tools: [
          {
            id: 'fetch-data',
            name: 'Fetch Data',
            description: 'Fetch from API',
            inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
            executable: { type: 'http', endpoint: 'http://localhost:3000/fetch' }
          }
        ]
      };

      const errors = validateManifest(manifest);
      assert.strictEqual(errors.length, 0, `Expected no errors, got: ${errors.join(', ')}`);
    });

    it('should reject manifest missing name', () => {
      const manifest = {
        version: '1.0.0',
        description: 'Sample tools',
        author: 'user@example.com',
        tools: []
      } as any;

      const errors = validateManifest(manifest);
      assert(errors.some(e => e.includes('name')));
    });

    it('should reject manifest missing version', () => {
      const manifest = {
        name: 'my-tools',
        description: 'Sample tools',
        author: 'user@example.com',
        tools: []
      } as any;

      const errors = validateManifest(manifest);
      assert(errors.some(e => e.includes('version')));
    });

    it('should reject tool with missing id', () => {
      const manifest: ExtensionManifest = {
        name: 'my-tools',
        version: '1.0.0',
        description: 'Sample tools',
        author: 'user@example.com',
        tools: [
          {
            id: '',
            name: 'Tool',
            description: 'Sample',
            inputSchema: { type: 'object' },
            executable: { type: 'http', endpoint: 'http://localhost:3000' }
          }
        ]
      };

      const errors = validateManifest(manifest);
      assert(errors.some(e => e.includes("'id'")));
    });

    it('should reject tool with missing executable', () => {
      const manifest: ExtensionManifest = {
        name: 'my-tools',
        version: '1.0.0',
        description: 'Sample tools',
        author: 'user@example.com',
        tools: [
          {
            id: 'tool-1',
            name: 'Tool',
            description: 'Sample',
            inputSchema: { type: 'object' },
            executable: {} as any
          }
        ]
      };

      const errors = validateManifest(manifest);
      assert(errors.some(e => e.includes('executable')));
    });

    it('should reject node executable without handler', () => {
      const manifest: ExtensionManifest = {
        name: 'my-tools',
        version: '1.0.0',
        description: 'Sample tools',
        author: 'user@example.com',
        tools: [
          {
            id: 'tool-1',
            name: 'Tool',
            description: 'Sample',
            inputSchema: { type: 'object' },
            executable: { type: 'node', path: './tool.js' } as any
          }
        ]
      };

      const errors = validateManifest(manifest);
      assert(errors.some(e => e.includes('handler')));
    });

    it('should reject http executable without endpoint', () => {
      const manifest: ExtensionManifest = {
        name: 'my-tools',
        version: '1.0.0',
        description: 'Sample tools',
        author: 'user@example.com',
        tools: [
          {
            id: 'tool-1',
            name: 'Tool',
            description: 'Sample',
            inputSchema: { type: 'object' },
            executable: { type: 'http' } as any
          }
        ]
      };

      const errors = validateManifest(manifest);
      assert(errors.some(e => e.includes('endpoint')));
    });

    it('should detect circular dependencies', () => {
      const manifest: ExtensionManifest = {
        name: 'my-tools',
        version: '1.0.0',
        description: 'Sample tools',
        author: 'user@example.com',
        tools: [
          {
            id: 'tool-a',
            name: 'Tool A',
            description: 'Sample',
            inputSchema: { type: 'object' },
            executable: { type: 'http', endpoint: 'http://localhost:3000' },
            dependencies: ['tool-b']
          },
          {
            id: 'tool-b',
            name: 'Tool B',
            description: 'Sample',
            inputSchema: { type: 'object' },
            executable: { type: 'http', endpoint: 'http://localhost:3000' },
            dependencies: ['tool-a']
          }
        ]
      };

      const errors = validateManifest(manifest);
      assert(errors.some(e => e.includes('Circular')));
    });

    it('should reject duplicate tool ids', () => {
      const manifest: ExtensionManifest = {
        name: 'my-tools',
        version: '1.0.0',
        description: 'Sample tools',
        author: 'user@example.com',
        tools: [
          {
            id: 'same-id',
            name: 'Tool A',
            description: 'Sample',
            inputSchema: { type: 'object' },
            executable: { type: 'http', endpoint: 'http://localhost:3000' }
          },
          {
            id: 'same-id',
            name: 'Tool B',
            description: 'Sample',
            inputSchema: { type: 'object' },
            executable: { type: 'http', endpoint: 'http://localhost:3000' }
          }
        ]
      };

      const errors = validateManifest(manifest);
      assert(errors.some(e => e.includes('duplicate')));
    });

    it('should reject invalid dependency reference', () => {
      const manifest: ExtensionManifest = {
        name: 'my-tools',
        version: '1.0.0',
        description: 'Sample tools',
        author: 'user@example.com',
        tools: [
          {
            id: 'tool-a',
            name: 'Tool A',
            description: 'Sample',
            inputSchema: { type: 'object' },
            executable: { type: 'http', endpoint: 'http://localhost:3000' },
            dependencies: ['nonexistent']
          }
        ]
      };

      const errors = validateManifest(manifest);
      assert(errors.some(e => e.includes("'nonexistent'")));
    });
  });

  describe('assertValidManifest', () => {
    it('should throw for invalid manifest', () => {
      const manifest = {
        name: 'my-tools',
        // missing version
        description: 'Sample tools',
        author: 'user@example.com',
        tools: []
      } as any;

      assert.throws(
        () => assertValidManifest(manifest),
        /Invalid manifest/
      );
    });

    it('should not throw for valid manifest', () => {
      const manifest: ExtensionManifest = {
        name: 'my-tools',
        version: '1.0.0',
        description: 'Sample tools',
        author: 'user@example.com',
        tools: [
          {
            id: 'fetch',
            name: 'Fetch',
            description: 'Fetch data',
            inputSchema: { type: 'object' },
            executable: { type: 'http', endpoint: 'http://localhost:3000' }
          }
        ]
      };

      assert.doesNotThrow(() => assertValidManifest(manifest));
    });
  });
});
