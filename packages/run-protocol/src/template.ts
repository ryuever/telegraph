import type { RUN_PROTOCOL_SCHEMA_VERSION } from './schema.js';

export interface RunTemplateVariable {
  name: string;
  description?: string;
  required?: boolean;
  defaultValue?: string;
}

export interface RunTemplate {
  templateId: string;
  title: string;
  description?: string;
  targetPagelet: string;
  promptTemplate: string;
  variables?: RunTemplateVariable[];
  sessionId?: string;
  metadata?: Record<string, unknown>;
  schemaVersion: typeof RUN_PROTOCOL_SCHEMA_VERSION;
}

export interface InstantiateRunTemplateInput {
  values?: Record<string, string | number | boolean | null | undefined>;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface RunTemplateInstantiation {
  templateId: string;
  targetPagelet: string;
  prompt: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export function instantiateRunTemplate(
  template: RunTemplate,
  input: InstantiateRunTemplateInput = {},
): RunTemplateInstantiation {
  const values = resolveTemplateValues(template, input.values ?? {});
  return pruneUndefined({
    templateId: template.templateId,
    targetPagelet: template.targetPagelet,
    prompt: renderPromptTemplate(template.promptTemplate, values),
    sessionId: input.sessionId ?? template.sessionId,
    metadata: {
      ...template.metadata,
      ...input.metadata,
      runTemplateId: template.templateId,
    },
  });
}

export function renderPromptTemplate(
  promptTemplate: string,
  values: Record<string, string>,
): string {
  return promptTemplate.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_-]*)\s*\}\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`Missing run template value: ${name}`);
    }
    return value;
  }).trim();
}

function resolveTemplateValues(
  template: RunTemplate,
  values: Record<string, string | number | boolean | null | undefined>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const variable of template.variables ?? []) {
    const raw = values[variable.name] ?? variable.defaultValue;
    if ((raw === undefined || raw === null || raw === '') && variable.required) {
      throw new Error(`Missing required run template variable: ${variable.name}`);
    }
    if (raw !== undefined && raw !== null) {
      resolved[variable.name] = String(raw);
    }
  }

  for (const [name, raw] of Object.entries(values)) {
    if (raw !== undefined && raw !== null) {
      resolved[name] = String(raw);
    }
  }
  return resolved;
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
