import { PiAiRuntime } from '@telegraph/agent/runtime/PiAiRuntime';
import { PiEmbeddedRuntime } from '@telegraph/agent/runtime/PiEmbeddedRuntime';
/**
 * Factory function to create a RuntimeExecutor instance.
 *
 * Supports:
 * - pi-ai: LLM-only streaming (in-process)
 * - pi-embedded: Pi-AI with embedded tool loop
 *
 * Future roadmap:
 * - Other frameworks: LangGraph, Vercel AI SDK, Mastra adapters
 *
 * NOTE: pi-cli (spawned process) is deprecated and removed from the runtime adapter pattern.
 * It was a temporary compatibility layer. Going forward, all execution happens in-process.
 *
 * @param settings Runtime configuration
 * @returns RuntimeExecutor instance ready to execute runs
 */
export function createRuntime(settings) {
    const backend = settings.backend ?? 'pi-ai';
    if (backend === 'pi-embedded') {
        return new PiEmbeddedRuntime();
    }
    if (backend === 'pi-ai') {
        return new PiAiRuntime();
    }
    throw new Error(`[createRuntime] Unknown backend: '${backend}'. Supported: 'pi-ai', 'pi-embedded'`);
}
/**
 * Create pi-ai runtime explicitly.
 * Useful when you want to ensure pi-ai execution at compile time.
 */
export function createPiAiRuntime() {
    return new PiAiRuntime();
}
