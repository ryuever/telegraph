/**
 * Executable Factory: Creates executor functions from ExecutableConfig
 * Supports node (dynamic import), python (subprocess), binary (subprocess), http (fetch)
 * 
 * ⚠️ This module is Node.js-only and cannot be imported in browser environments
 */

if (typeof window !== 'undefined') {
  throw new Error(
    'ExecutableFactory is a Node.js-only module and cannot be used in browser environments. ' +
    'This error indicates incorrect module resolution. Ensure ExecutableFactory is only imported ' +
    'in Node.js contexts via @/packages/agent/extensions/node'
  );
}

import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolve } from 'path';
import type { ExecutableConfig } from '../ExtensionManifest';

const execFileAsync = promisify(execFile);

export type ToolExecutor = (input: Record<string, any>) => Promise<any>;

/**
 * Create executor function from executable config
 */
export async function createExecutor(
  config: ExecutableConfig,
  baseDir: string
): Promise<ToolExecutor> {
  switch (config.type) {
    case 'node':
      return createNodeExecutor(config, baseDir);
    case 'python':
      return createPythonExecutor(config, baseDir);
    case 'binary':
      return createBinaryExecutor(config, baseDir);
    case 'http':
      return createHttpExecutor(config);
    default:
      throw new Error(`Unknown executable type: ${config.type}`);
  }
}

/**
 * Node executor: dynamic import + call handler function
 */
async function createNodeExecutor(
  config: ExecutableConfig,
  baseDir: string
): Promise<ToolExecutor> {
  if (!config.path || !config.handler) {
    throw new Error('Node executor requires path and handler');
  }

  const modulePath = resolve(baseDir, config.path);
  let handlerFn: (...args: any[]) => Promise<any>;

  try {
    // Try dynamic import first (ESM)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const module = await import(/* @vite-ignore */ modulePath);
    handlerFn = module[config.handler];

    if (typeof handlerFn !== 'function') {
      throw new Error(`Handler '${config.handler}' is not a function`);
    }
  } catch (err) {
    // Fallback to require (CommonJS)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const module = require(modulePath);
      handlerFn = module[config.handler];

      if (typeof handlerFn !== 'function') {
        throw new Error(`Handler '${config.handler}' is not a function`);
      }
    } catch (e) {
      throw new Error(
        `Failed to load node module '${modulePath}': ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return async (input: Record<string, any>) => {
    return handlerFn(input);
  };
}

/**
 * Python executor: subprocess call to python script
 */
async function createPythonExecutor(
  config: ExecutableConfig,
  baseDir: string
): Promise<ToolExecutor> {
  if (!config.path || !config.handler) {
    throw new Error('Python executor requires path and handler');
  }

  const scriptPath = resolve(baseDir, config.path);

  return async (input: Record<string, any>) => {
    // Pass input as JSON via stdin
    const inputJson = JSON.stringify(input);

    try {
      const { stdout } = await execFileAsync('python', [
        '-c',
        `import sys, json, importlib.util; spec = importlib.util.spec_from_file_location('script', '${scriptPath}'); mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); result = getattr(mod, '${config.handler}')(json.loads(sys.stdin.read())); print(json.dumps(result))`
      ]);

      return JSON.parse(stdout);
    } catch (error) {
      throw new Error(
        `Python executor failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}

/**
 * Binary executor: spawn subprocess and pass input as JSON arg
 */
async function createBinaryExecutor(
  config: ExecutableConfig,
  baseDir: string
): Promise<ToolExecutor> {
  if (!config.path) {
    throw new Error('Binary executor requires path');
  }

  const binPath = resolve(baseDir, config.path);
  const args = config.args || [];

  return async (input: Record<string, any>) => {
    const inputJson = JSON.stringify(input);

    try {
      const { stdout } = await execFileAsync(binPath, args);

      return JSON.parse(stdout);
    } catch (error) {
      throw new Error(
        `Binary executor failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}

/**
 * HTTP executor: POST JSON to webhook endpoint
 */
async function createHttpExecutor(config: ExecutableConfig): Promise<ToolExecutor> {
  if (!config.endpoint) {
    throw new Error('HTTP executor requires endpoint');
  }

  const endpoint = config.endpoint;

  return async (input: Record<string, any>) => {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json();
    } catch (error) {
      throw new Error(
        `HTTP executor failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}
