import { createId } from '@x-oasis/di';

export const SETTING_PARTICIPANT_ID = 'setting';

export const SETTING_PAGELET_SERVICE_PATH = 'setting-pagelet-api';

export type PiAiProviderAuthMode = 'api-key' | 'subscription';

export interface PiAiProviderDescriptor {
  id: string;
  displayName: string;
  modelCount: number;
  supportsSubscription: boolean;
  supportsApiKey: boolean;
  environmentKeyName?: string;
}

export interface PiAiModelDescriptor {
  id: string;
  label: string;
  provider: string;
  api?: string;
  baseUrl?: string;
}

export interface PiAiConnectionTestInput {
  provider: string;
  modelId: string;
  authMode: PiAiProviderAuthMode;
  apiKey?: string;
  subscriptionProvider?: string;
  subscriptionCredentials?: {
    refresh: string;
    access: string;
    expires: number;
    [key: string]: unknown;
  };
  timeoutMs?: number;
}

export interface PiAiConnectionTestResult {
  ok: boolean;
  provider: string;
  modelId: string;
  authMode: PiAiProviderAuthMode;
  latencyMs: number;
  resolvedApiKey?: string;
  refreshedSubscriptionCredentials?: {
    refresh: string;
    access: string;
    expires: number;
    [key: string]: unknown;
  };
  responseModel?: string;
  error?: string;
}

export interface PiAiModelConfigUpsertInput {
  provider: string;
  modelId: string;
  modelLabel?: string;
  api?: string;
  baseUrl?: string;
}

export interface PiAiProviderConfigUpsertInput {
  provider: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
}

export interface PiAiProviderConfigSnapshot {
  baseUrl: string;
  api?: string;
  apiKey: string;
}

export interface ISettingPageletService {
  info(): Promise<string>;
  callSharedEcho(msg: string): Promise<string>;
  callSharedGetConfig(key: string): Promise<string>;
  callSharedSetConfig(key: string, value: string): Promise<string>;
  callDaemonEcho(msg: string): Promise<string>;
  callDaemonSystemStatus(): Promise<string>;
  callMainPing(msg: string): Promise<string>;
  listPiAiProviders(): Promise<PiAiProviderDescriptor[]>;
  listPiAiModels(provider: string): Promise<PiAiModelDescriptor[]>;
  testPiAiConnection(input: PiAiConnectionTestInput): Promise<PiAiConnectionTestResult>;
  getPiAiModelsJson(): Promise<string>;
  savePiAiModelsJson(content: string): Promise<void>;
  upsertPiAiModelConfig(input: PiAiModelConfigUpsertInput): Promise<void>;
  getPiAiProviderConfig(provider: string): Promise<PiAiProviderConfigSnapshot>;
  upsertPiAiProviderConfig(input: PiAiProviderConfigUpsertInput): Promise<void>;
}

export interface ISettingApplication {
  start(): Promise<void>;
}

export const SettingApplicationId = createId('SettingApplication');

export {
  PI_AI_API_KEY_PROVIDER_NAMES,
  PI_AI_OAUTH_PROVIDER_NAMES,
  PI_AI_PROVIDER_DEFAULT_BASE_URLS,
  buildPiAiProviderCatalog,
  parseCustomProviderIdsFromModelsJson,
  parseProviderConfigFromModelsJson,
  resolveProviderApiKey,
  resolveProviderBaseUrl,
} from '@/apps/setting/application/common/pi-ai-provider-catalog';
export type { PiAiProviderConfigFromJson } from '@/apps/setting/application/common/pi-ai-provider-catalog';
