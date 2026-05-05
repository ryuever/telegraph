import { stream } from '@mariozechner/pi-ai';
import { resolveModel } from '@telegraph/agent/providers/index';
/**
 * Default in-process backend built on top of pi-ai.
 */
export class PiAiBackend {
    settings;
    kind = 'pi-ai';
    constructor(settings) {
        this.settings = settings;
    }
    get currentSettings() {
        return this.settings;
    }
    withSettings(next) {
        return new PiAiBackend(next);
    }
    async send(input) {
        console.log('send ', input);
        const model = resolveModel(this.settings);
        console.log('send model', model);
        const context = {
            systemPrompt: input.systemPrompt ?? 'You are a helpful assistant.',
            messages: input.messages.map(m => ({ role: m.role, content: m.content })),
            tools: input.tools ?? [],
        };
        const cb = input.callbacks ?? {};
        cb.onStart?.();
        await input.onPiAiRequest?.({
            context,
            options: {
                hasApiKey: Boolean(this.settings.apiKey?.trim()),
                signal: Boolean(input.signal),
            },
        });
        console.log('context', context);
        const s = stream(model, context, {
            apiKey: this.settings.apiKey,
            signal: input.signal,
        });
        try {
            for await (const event of s) {
                console.log('stream event', event);
                if (input.signal?.aborted)
                    break;
                await input.onPiAiStreamEvent?.(event);
                switch (event.type) {
                    case 'text_delta':
                        cb.onTextDelta?.(event.delta);
                        break;
                    case 'thinking_delta':
                        cb.onThinkingDelta?.(event.delta);
                        break;
                    case 'toolcall_start':
                        cb.onToolCallStart?.({ id: event.toolCall?.id ?? '', name: event.toolCall?.name ?? '' });
                        break;
                    case 'toolcall_end':
                        cb.onToolCallEnd?.(event.toolCall);
                        break;
                    case 'done':
                        cb.onDone?.(event.reason, event.message);
                        break;
                    case 'error':
                        cb.onError?.(event.reason, event.error);
                        break;
                }
            }
            const final = await s.result();
            return final;
        }
        catch (err) {
            cb.onError?.('error', { role: 'assistant', content: [{ type: 'text', text: String(err) }] });
            throw err;
        }
    }
}
