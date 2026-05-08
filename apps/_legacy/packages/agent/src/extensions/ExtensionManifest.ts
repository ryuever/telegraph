/**
 * Extension Manifest Types & Parser
 * Supports YAML and JSON manifest formats
 */

export type ExecutableType = 'node' | 'python' | 'binary' | 'http';

export type PermissionType =
  | 'network'
  | 'filesystem:read'
  | 'filesystem:write'
  | 'environment'
  | 'subprocess';

export interface ExecutableConfig {
  type: ExecutableType;
  path?: string; // For node, python, binary (relative to extension dir)
  handler?: string; // For node, python (export function name)
  endpoint?: string; // For http (webhook URL)
  args?: string[]; // For binary (command-line args)
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier?: number; // exponential backoff
}

export interface Permission {
  type: PermissionType;
  resource?: string; // e.g., /data for filesystem:read:/data
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, any>; // JSONSchema
  executable: ExecutableConfig;
  dependencies?: string[]; // other tool IDs
  maxConcurrency?: number;
  timeout?: number; // ms
  retryPolicy?: RetryPolicy;
  permissions?: Permission[];
}

export interface LLMHints {
  model?: string;
  temperature?: number;
  systemPrompt?: string;
  maxTokens?: number;
}

export interface ExtensionManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  tools: ToolDefinition[];
  llmHints?: LLMHints;
  keywords?: string[];
  license?: string;
  repository?: string;
}

/**
 * Parse YAML or JSON manifest
 */
export function parseManifest(content: string, format: 'yaml' | 'json'): ExtensionManifest {
  if (format === 'json') {
    return JSON.parse(content);
  } else if (format === 'yaml') {
    // Lazy load yaml parser to avoid hard dependency
    // For now, throw error if YAML is requested but parser not available
    throw new Error('YAML parsing requires external parser; use JSON format or provide yaml parser');
  } else {
    throw new Error(`Unknown manifest format: ${format}`);
  }
}

/**
 * Validate manifest structure and content
 */
export function validateManifest(manifest: ExtensionManifest): string[] {
  const errors: string[] = [];

  // Required fields
  if (!manifest.name || typeof manifest.name !== 'string') {
    errors.push('Manifest missing required field: name (string)');
  }
  if (!manifest.version || typeof manifest.version !== 'string') {
    errors.push('Manifest missing required field: version (string)');
  }
  if (!manifest.description || typeof manifest.description !== 'string') {
    errors.push('Manifest missing required field: description (string)');
  }
  if (!manifest.author || typeof manifest.author !== 'string') {
    errors.push('Manifest missing required field: author (string)');
  }
  if (!manifest.tools || !Array.isArray(manifest.tools)) {
    errors.push('Manifest missing required field: tools (array)');
    return errors; // Can't validate tools without this
  }

  // Validate tools
  const toolIds = new Set<string>();
  for (let i = 0; i < manifest.tools.length; i++) {
    const tool = manifest.tools[i];
    const prefix = `tools[${i}]`;

    // Required fields
    if (!tool.id || typeof tool.id !== 'string') {
      errors.push(`${prefix}: missing required field 'id'`);
    } else if (toolIds.has(tool.id)) {
      errors.push(`${prefix}: duplicate tool id '${tool.id}'`);
    } else {
      toolIds.add(tool.id);
    }

    if (!tool.name || typeof tool.name !== 'string') {
      errors.push(`${prefix}: missing required field 'name'`);
    }
    if (!tool.description || typeof tool.description !== 'string') {
      errors.push(`${prefix}: missing required field 'description'`);
    }
    if (!tool.executable || typeof tool.executable !== 'object') {
      errors.push(`${prefix}: missing required field 'executable'`);
    } else {
      const exe = tool.executable;
      if (!exe.type || !['node', 'python', 'binary', 'http'].includes(exe.type)) {
        errors.push(`${prefix}.executable: invalid type '${exe.type}'`);
      }
      if (exe.type !== 'http' && !exe.path) {
        errors.push(`${prefix}.executable: missing 'path' for type '${exe.type}'`);
      }
      if (exe.type === 'http' && !exe.endpoint) {
        errors.push(`${prefix}.executable: missing 'endpoint' for type 'http'`);
      }
      if ((exe.type === 'node' || exe.type === 'python') && !exe.handler) {
        errors.push(`${prefix}.executable: missing 'handler' for type '${exe.type}'`);
      }
    }

    if (!tool.inputSchema || typeof tool.inputSchema !== 'object') {
      errors.push(`${prefix}: missing required field 'inputSchema'`);
    }

    // Validate dependencies reference existing tools
    if (tool.dependencies && Array.isArray(tool.dependencies)) {
      for (const dep of tool.dependencies) {
        if (!toolIds.has(dep)) {
          errors.push(`${prefix}: dependency '${dep}' not found in tools`);
        }
      }
    }

    // Validate timeout
    if (tool.timeout !== undefined && typeof tool.timeout !== 'number') {
      errors.push(`${prefix}: timeout must be a number`);
    }

    // Validate maxConcurrency
    if (tool.maxConcurrency !== undefined && typeof tool.maxConcurrency !== 'number') {
      errors.push(`${prefix}: maxConcurrency must be a number`);
    }
  }

  // Validate no circular dependencies
  const cycles = detectCycles(manifest.tools);
  if (cycles.length > 0) {
    errors.push(`Circular dependencies detected: ${cycles.join(', ')}`);
  }

  return errors;
}

/**
 * Detect circular dependencies in tools
 */
function detectCycles(tools: ToolDefinition[]): string[] {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const cycles: string[] = [];

  const dfs = (toolId: string): void => {
    visited.add(toolId);
    recursionStack.add(toolId);

    const tool = tools.find(t => t.id === toolId);
    if (!tool || !tool.dependencies) {
      recursionStack.delete(toolId);
      return;
    }

    for (const dep of tool.dependencies) {
      if (!visited.has(dep)) {
        dfs(dep);
      } else if (recursionStack.has(dep)) {
        cycles.push(`${toolId} -> ${dep}`);
      }
    }

    recursionStack.delete(toolId);
  };

  for (const tool of tools) {
    if (!visited.has(tool.id)) {
      dfs(tool.id);
    }
  }

  return cycles;
}

/**
 * Check if manifest is valid; throws if not
 */
export function assertValidManifest(manifest: ExtensionManifest): void {
  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`Invalid manifest:\n${errors.join('\n')}`);
  }
}
