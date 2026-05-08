/**
 * Node.js-only extension utilities
 * This module is only available in Node.js environments (main process, services, etc.)
 * Not available in browser/renderer process
 */

export { createExecutor, type ToolExecutor } from './ExecutableFactory';
export { ExtensionRegistry, type LoadedExtension } from './ExtensionRegistry';
