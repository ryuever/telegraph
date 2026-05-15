/**
 * ExtensionRegistry: Load, validate, and manage extensions
 * Integrates manifests with ToolRegistry for dynamic tool registration
 * 
 * ⚠️ This module is Node.js-only and cannot be imported in browser environments
 */

if (typeof window !== 'undefined') {
  throw new Error(
    'ExtensionRegistry is a Node.js-only module and cannot be used in browser environments. ' +
    'This error indicates incorrect module resolution. Ensure ExtensionRegistry is only imported ' +
    'in Node.js contexts via @/packages/agent/extensions/node'
  );
}

import * as fs from 'fs';
import * as path from 'path';
import type { ToolRegistry, ToolDefinition as RegistryToolDefinition } from '../../runtime/toolExecution/ToolRegistry';
import type { ExtensionManifest, ToolDefinition as ManifestToolDefinition } from '../ExtensionManifest';
import { assertValidManifest } from '../ExtensionManifest';
import { createExecutor, type ToolExecutor } from './ExecutableFactory';
import { createLogger } from '@/packages/services/log/node/logger'
const logger = createLogger('agent')

export interface LoadedExtension {
  manifest: ExtensionManifest;
  baseDir: string;
  tools: Map<string, RegistryToolDefinition>;
  status: 'loaded' | 'unloaded';
  loadedAt: Date;
}

/**
 * Registry for managing extensions and their tools
 */
export class ExtensionRegistry {
  private extensions: Map<string, LoadedExtension> = new Map();
  private toolToExtension: Map<string, string> = new Map(); // toolId -> extensionName
  private extensionDirs: string[] = [];

  constructor(private toolRegistry: ToolRegistry) {}

  /**
   * Set directories to scan for extensions
   */
  setExtensionDirs(dirs: string[]): void {
    this.extensionDirs = dirs;
  }

  /**
   * Scan directories and load all extensions
   */
  async loadExtensionsFromDirs(): Promise<void> {
    for (const dir of this.extensionDirs) {
      if (!fs.existsSync(dir)) {
        logger.warn(`Extension directory not found: ${dir}`);
        continue;
      }

      try {
        await this.scanDir(dir);
      } catch (error) {
        logger.error(`Failed to scan extension directory ${dir}`, error as Error);
      }
    }
  }

  /**
   * Scan a directory for extension manifests (extension.json or extension.yml)
   */
  private async scanDir(dir: string): Promise<void> {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const extensionDir = path.join(dir, entry.name);

      // Look for extension.json
      const jsonPath = path.join(extensionDir, 'extension.json');
      if (fs.existsSync(jsonPath)) {
        try {
          await this.loadExtensionFromPath(jsonPath);
        } catch (error) {
          logger.error(`Failed to load extension from ${jsonPath}`, error as Error);
        }
        continue;
      }

      // Look for extension.yml or extension.yaml
      const ymlPath = path.join(extensionDir, 'extension.yml');
      if (fs.existsSync(ymlPath)) {
        logger.warn(
          `YAML manifest found at ${ymlPath}, but YAML parser not implemented; use JSON format`
        );
        continue;
      }

      const yamlPath = path.join(extensionDir, 'extension.yaml');
      if (fs.existsSync(yamlPath)) {
        logger.warn(
          `YAML manifest found at ${yamlPath}, but YAML parser not implemented; use JSON format`
        );
        continue;
      }
    }
  }

  /**
   * Load a single extension from manifest file path
   */
  async loadExtensionFromPath(manifestPath: string): Promise<void> {
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Manifest file not found: ${manifestPath}`);
    }

    const content = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(content) as ExtensionManifest;

    // Validate manifest
    assertValidManifest(manifest);

    const baseDir = path.dirname(manifestPath);
    const extension: LoadedExtension = {
      manifest,
      baseDir,
      tools: new Map(),
      status: 'loaded',
      loadedAt: new Date()
    };

    // Create and register tools
    for (const toolDef of manifest.tools) {
      try {
        const tool = await this.createToolFromDef(toolDef, baseDir);
        extension.tools.set(toolDef.id, tool);
        this.toolRegistry.register(tool);
        this.toolToExtension.set(toolDef.id, manifest.name);
      } catch (error) {
        logger.error(`Failed to create tool ${toolDef.id}`, error as Error);
        // Continue loading other tools
      }
    }

    this.extensions.set(manifest.name, extension);
    logger.info(
      `Loaded extension '${manifest.name}' with ${extension.tools.size} tools from ${baseDir}`
    );
  }

  /**
   * Create Tool from ToolDefinition
   */
  private async createToolFromDef(
    toolDef: ManifestToolDefinition,
    baseDir: string
  ): Promise<RegistryToolDefinition> {
    const executor = await createExecutor(toolDef.executable, baseDir);

    const wrappedExecutor = this.createToolExecutor(
      executor,
      toolDef.timeout || 30000,
      toolDef.retryPolicy
    );

    return {
      id: toolDef.id,
      name: toolDef.name,
      description: toolDef.description,
      parameters: this.convertInputSchemaToParameters(toolDef.inputSchema),
      execute: wrappedExecutor,
      source: 'extension'
    };
  }

  /**
   * Convert JSONSchema inputSchema to ToolParameters format
   */
  private convertInputSchemaToParameters(
    inputSchema: Record<string, any>
  ): RegistryToolDefinition['parameters'] | undefined {
    if (!inputSchema || inputSchema.type !== 'object') {
      return undefined;
    }

    return {
      type: 'object',
      properties: inputSchema.properties || {},
      required: inputSchema.required
    };
  }

  /**
   * Wrap tool executor with timeout and retry logic
   */
  private createToolExecutor(
    executor: ToolExecutor,
    timeout: number,
    retryPolicy?: { maxAttempts: number; backoffMs: number }
  ): (input: Record<string, any>) => Promise<any> {
    return async (input: Record<string, any>) => {
      let lastError: Error | null = null;
      const maxAttempts = retryPolicy?.maxAttempts || 1;
      const baseBackoff = retryPolicy?.backoffMs || 1000;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          // Apply timeout
          return await Promise.race([
            executor(input),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Tool execution timeout after ${timeout}ms`)),
                timeout
              )
            )
          ]);
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          if (attempt < maxAttempts - 1) {
            const backoffMs = baseBackoff * Math.pow(2, attempt);
            logger.warn(
              `Tool execution attempt ${attempt + 1} failed, retrying in ${backoffMs}ms: ${lastError.message}`
            );
            await new Promise(resolve => setTimeout(resolve, backoffMs));
          }
        }
      }

      throw lastError || new Error('Tool execution failed');
    };
  }

  /**
   * Unload an extension (unregister its tools)
   */
  async unloadExtension(name: string): Promise<void> {
    const ext = this.extensions.get(name);
    if (!ext) {
      throw new Error(`Extension '${name}' not loaded`);
    }

    for (const toolId of ext.tools.keys()) {
      this.toolRegistry.unregister(toolId);
      this.toolToExtension.delete(toolId);
    }

    ext.status = 'unloaded';
    this.extensions.delete(name);
    logger.info(`Unloaded extension '${name}'`);
  }

  /**
   * Get all loaded extensions
   */
  getLoadedExtensions(): LoadedExtension[] {
    return Array.from(this.extensions.values());
  }

  /**
   * Get extension by name
   */
  getExtension(name: string): LoadedExtension | undefined {
    return this.extensions.get(name);
  }

  /**
   * Get all tools from all extensions
   */
  getAllTools(): RegistryToolDefinition[] {
    const tools: RegistryToolDefinition[] = [];
    for (const ext of this.extensions.values()) {
      tools.push(...Array.from(ext.tools.values()));
    }
    return tools;
  }
}
