import {
  CHAT_PAGELET_SERVICE_PATH,
  type IChatPageletService,
} from '@/apps/chat/application/common';
import { client } from '@/apps/main/application/browser/rpc-clients';

/**
 * Lazy accessor for the chat pagelet's RPC proxy.
 *
 * See `apps/connection/.../getClient.ts` for the full rationale.
 * Consumed by `PageletAgentService`; chat runs through the pagelet RPC path.
 */
let cached: IChatPageletService | null = null;

export function getChatPageletClient(): IChatPageletService {
  if (!cached) {
    cached = client.getProxy(
      CHAT_PAGELET_SERVICE_PATH
    ) as unknown as IChatPageletService;
  }
  return cached;
}
