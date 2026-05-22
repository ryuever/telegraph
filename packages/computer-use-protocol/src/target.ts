export type ComputerTargetKind = 'desktop' | 'app' | 'window' | 'browser_tab' | 'isolated_browser' | 'vm';

export interface ComputerTarget {
  targetId: string;
  kind: ComputerTargetKind;
  label?: string;
  appId?: string;
  windowId?: string;
  browserTabId?: string;
  scope?: {
    includeApps?: string[];
    excludeApps?: string[];
    includeDomains?: string[];
    excludeDomains?: string[];
  };
}
