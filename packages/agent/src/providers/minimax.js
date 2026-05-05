/**
 * pi-ai ships first-class `minimax` and `minimax-cn` providers (Anthropic-
 * messages API, `https://api.minimax.io/anthropic` and `.../minimaxi.com/...`).
 * Use those directly via `getModel('minimax', '<id>')`.
 *
 * The helper below builds an OpenAI-compatible Model definition for users who
 * want to point at MiniMax's `/v1/chat/completions` endpoint or at a proxy
 * that re-exposes MiniMax under an OpenAI-style URL. Kept as an escape hatch.
 */
export const MINIMAX_OPENAI_BASE_URL = 'https://api.minimaxi.chat/v1';
export function createMiniMaxOpenAIModel({ id, contextWindow = 245_000, maxTokens = 8192, baseUrl = MINIMAX_OPENAI_BASE_URL, }) {
    return {
        id,
        name: id,
        api: 'openai-completions',
        provider: 'minimax-openai-compat',
        baseUrl,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        maxTokens,
    };
}
