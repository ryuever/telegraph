// Ambient renderer globals exposed by `preload.ts`.
import type { TelegraphPreloadApi } from './application/preload/preload';

declare global {
  interface Window {
    telegraph: TelegraphPreloadApi;
  }
}

export {};
