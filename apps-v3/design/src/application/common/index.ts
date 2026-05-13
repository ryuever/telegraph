export const DESIGN_PAGELET_SERVICE_PATH = 'design-pagelet-api';

export interface IDesignPageletService {
  info(): Promise<string>;
  ping(now: number): Promise<{ pong: number; serverTime: number }>;
}
