# Extensions Module Structure

## Problem Fixed

The application was crashing with:
```
Uncaught Error: Module "child_process" has been externalized for browser compatibility.
Cannot access "child_process.execFile" in client code.
```

This occurred because `ExecutableFactory` and `ExtensionRegistry` were being imported into the renderer process (browser), but they use Node.js-only APIs.

## Solution

Separated Node.js-only code into a dedicated `node/` subdirectory:

### File Structure

```
packages/agent/src/extensions/
├── node/                            # 🔴 Node.js-only code
│   ├── ExecutableFactory.ts        # Uses: child_process, util, path
│   ├── ExtensionRegistry.ts        # Uses: fs, path
│   ├── ExtensionRegistry.test.ts   # Node.js environment tests
│   └── index.ts                    # Re-exports for node environment
│
├── 🟢 Browser-safe code
├── ExtensionManifest.ts            # Type definitions only
└── __tests__/
    └── ExtensionManifest.test.ts   # Type validation tests
```

### Code Organization Rules

**Browser-safe modules** (can be imported anywhere):
- `ExtensionManifest.ts` - Type definitions and validation
- Any module in `__tests__/` directory (for non-Node.js tests)

**Node.js-only modules** (must be imported from `extensions/node`):
- `ExecutableFactory.ts` - Dynamic module loading with child_process
- `ExtensionRegistry.ts` - File system operations for extension management
- `ExtensionRegistry.test.ts` - Tests that require Node.js environment

## Import Patterns

### ❌ Wrong (will cause browser errors)
```typescript
import { ExtensionRegistry } from '@telegraph/agent/extensions/ExtensionRegistry'
import { createExecutor } from '@telegraph/agent/extensions/ExecutableFactory'
```

### ✅ Correct (Node.js environments only)
```typescript
// In main process, services, or build tools only:
import { ExtensionRegistry } from '@telegraph/agent/extensions/node'
import { createExecutor } from '@telegraph/agent/extensions/node'
```

### ✅ Correct (Any environment)
```typescript
// Browser-safe type definitions:
import type { ExtensionManifest, ExecutableConfig } from '@telegraph/agent/extensions'
import { validateManifest, parseManifest } from '@telegraph/agent/extensions'
```

## Configuration

Updated `packages/agent/package.json` exports:
```json
{
  "exports": {
    ".": "./src/index.ts",
    "./extensions/*": "./src/extensions/*.ts",
    "./*": "./src/*.ts"
  }
}
```

This allows:
- ✅ `@telegraph/agent/extensions/ExtensionManifest` (re-exports from root)
- ✅ `@telegraph/agent/extensions/node` (node/ subdir)
- ✅ Type-only imports from anywhere

## Main Index Exports

File: `packages/agent/src/index.ts`

```typescript
// Browser-safe exports (available everywhere)
export { validateManifest, assertValidManifest, parseManifest, ... } 
  from '@telegraph/agent/extensions/ExtensionManifest'

// Node.js-only exports (renderer will skip these at build time)
export { ExtensionRegistry, type LoadedExtension } 
  from '@telegraph/agent/extensions/node'
export { createExecutor, type ToolExecutor as ExtensionToolExecutor } 
  from '@telegraph/agent/extensions/node'
```

## How Vite Handles This

When building for the renderer (browser):
1. Vite sees `extensions/node` imports
2. Detects Node.js modules like `child_process`, `fs`, `path`
3. **Marks these as externalized** (excluded from bundle)
4. Build succeeds but modules won't load in browser

When building for main process (Node.js):
1. Vite includes all code normally
2. Node.js modules are available
3. Everything works as expected

## Usage Examples

### Main Process / Services
```typescript
// ✅ OK - Node.js environment
import { ExtensionRegistry } from '@telegraph/agent/extensions/node'

const registry = new ExtensionRegistry()
await registry.loadExtension(manifestPath)
```

### Renderer Process
```typescript
// ✅ OK - Type definitions only
import type { ExtensionManifest } from '@telegraph/agent/extensions'
import { validateManifest } from '@telegraph/agent/extensions'

const isValid = validateManifest(manifest)

// ❌ Will fail - ExtensionRegistry uses fs/path
// import { ExtensionRegistry } from '@telegraph/agent/extensions/node'
```

## TypeScript Compilation

Verified with `pnpm exec tsc --noEmit`:
- ✅ Zero errors
- ✅ All imports correctly resolved
- ✅ Type safety maintained

## Related Files

- `packages/agent/package.json` - Exports configuration
- `packages/agent/src/index.ts` - Main re-exports
- `packages/agent/src/extensions/node/index.ts` - Node-only re-exports

---
**Fixed**: 2026-05-05 20:35 UTC
**Commit**: dc73689
**Impact**: Eliminates "Module externalized for browser compatibility" errors
