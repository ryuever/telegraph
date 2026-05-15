import { createId } from '@x-oasis/di';

export const DESIGN_PAGELET_SERVICE_PATH = 'design-pagelet-api';

export interface IDesignPageletService {
  info(): Promise<string>;
  ping(now: number): Promise<{ pong: number; serverTime: number }>;
}

export interface IDesignApplication {
  start(): Promise<void>;
}

export const DesignApplicationId = createId('DesignApplication');
