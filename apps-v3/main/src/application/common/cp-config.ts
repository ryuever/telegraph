export const ORCHESTRATOR_CP_CHANNEL_NAME = 'multi-page-router-cp';
export const ORCHESTRATOR_PROJECT_NAME = 'multi-page-router-di';

export const CONNECTION_PAGE = {
  id: 'connection',
  label: 'Connection',
  color: '#3b82f6',
  description: 'Connection Management',
} as const;

export const MONITOR_PAGE = {
  id: 'monitor',
  label: 'Monitor',
  color: '#10b981',
  description: 'Performance Monitor',
} as const;

export const DESIGN_PAGE = {
  id: 'design',
  label: 'Design',
  color: '#8b5cf6',
  description: 'Design Workspace',
} as const;

export const CHAT_PAGE = {
  id: 'chat',
  label: 'Chat',
  color: '#f59e0b',
  description: 'AI Chat Assistant',
} as const;

export type PageConfig = typeof CONNECTION_PAGE | typeof MONITOR_PAGE | typeof DESIGN_PAGE | typeof CHAT_PAGE;

export const ALL_PAGES: PageConfig[] = [CONNECTION_PAGE, MONITOR_PAGE, DESIGN_PAGE, CHAT_PAGE];
