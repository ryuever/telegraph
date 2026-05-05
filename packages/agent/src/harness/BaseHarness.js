import { createAgentBackend } from '@telegraph/agent/backends/createAgentBackend';
/**
 * Foundation for the future harness framework. A harness owns:
 *   - the rolling conversation (system prompt + messages)
 *   - the tool registry advertised to the model
 *   - the run loop (currently single-turn; will grow into a tool-call loop)
 *
 * Subclasses (CodingHarness, ChatHarness, ResearchHarness, …) layer on
 * domain-specific tools, system prompts, and post-processing. This base class
 * keeps the contract narrow on purpose — the surface is what every harness
 * needs, no more.
 */
export class BaseHarness {
    agent;
    state;
    tools;
    constructor(opts) {
        this.agent = createAgentBackend(opts.settings);
        this.state = {
            systemPrompt: opts.systemPrompt ?? 'You are a helpful assistant.',
            messages: [],
        };
        this.tools = opts.tools ?? [];
    }
    getState() {
        return this.state;
    }
    setSettings(next) {
        this.agent = this.agent.withSettings(next);
    }
    setSystemPrompt(prompt) {
        this.state.systemPrompt = prompt;
    }
    setTools(tools) {
        this.tools = tools;
    }
    reset() {
        this.state.messages = [];
    }
    appendMessage(msg) {
        this.state.messages.push(msg);
    }
    /**
     * Single-turn run. Tool-call loops, parallel calls, and message editing
     * belong in subclasses for now — this base path stays simple so the contract
     * is obvious.
     */
    async run({ userMessage, signal }, handlers = {}) {
        this.state.messages.push({ role: 'user', content: userMessage });
        let acc = '';
        handlers.onAssistantStart?.();
        try {
            await this.agent.send({
                systemPrompt: this.state.systemPrompt,
                messages: this.state.messages,
                tools: this.tools,
                signal,
                callbacks: {
                    onTextDelta: delta => {
                        acc += delta;
                        handlers.onAssistantDelta?.(delta);
                    },
                    onToolCallEnd: call => handlers.onToolCall?.(call),
                    onError: (_reason, _msg) => handlers.onError?.(new Error(_reason)),
                },
            });
        }
        catch (err) {
            handlers.onError?.(err);
            throw err;
        }
        this.state.messages.push({ role: 'assistant', content: acc });
        handlers.onAssistantEnd?.(acc);
        return acc;
    }
}
