/**
 * Placeholder backend for future Pi CLI-based execution.
 * M1 only wires the selection channel; implementation lands in M2.
 */
export class PiCliBackend {
    settings;
    kind = 'pi-cli';
    constructor(settings) {
        this.settings = settings;
    }
    get currentSettings() {
        return this.settings;
    }
    withSettings(next) {
        return new PiCliBackend(next);
    }
    async send(input) {
        const cb = input.callbacks ?? {};
        cb.onStart?.();
        const err = new Error('PiCliBackend is not implemented yet');
        cb.onError?.('error', { role: 'assistant', content: [{ type: 'text', text: err.message }] });
        throw err;
    }
}
