import { PiAiBackend } from '@telegraph/agent/backends/PiAiBackend';
import { PiCliBackend } from '@telegraph/agent/backends/PiCliBackend';
export function createAgentBackend(settings) {
    console.log('createAgentBackend', settings);
    switch (settings.backend) {
        case 'pi-cli':
            return new PiCliBackend(settings);
        case 'pi-ai':
        default:
            return new PiAiBackend(settings);
    }
}
