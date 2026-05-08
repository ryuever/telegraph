// Phase 3 — DesignApplication: the design utility's "business" service.
//
// Implements `IDesignService` from the shared contract. Phase 3 only `ping()`
// is wired (used to prove the renderer↔utility direct channel works in
// Phase 4 once the Connect button is hooked up).  Phase 5+ this class will
// gain real design-pagelet operations.
//
// Lives under `application/node/` because it executes inside the Node.js
// runtime that Electron's `utilityProcess` provides — no DOM, no Electron
// main-process APIs.
import { createId, injectable } from '@x-oasis/di';

import type { IDesignService } from '@telegraph/services/connection-orchestrator/common/types';

@injectable()
export class DesignApplication implements IDesignService {
  ping(now: number): Promise<{ pong: number; serverTime: number }> {
    return Promise.resolve({ pong: now, serverTime: Date.now() });
  }
}

export const DesignApplicationId = createId('DesignApplication');
