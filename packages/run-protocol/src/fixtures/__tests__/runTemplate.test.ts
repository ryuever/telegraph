import { describe, expect, it } from 'vitest';
import { RUN_PROTOCOL_SCHEMA_VERSION } from '../../schema.js';
import {
  instantiateRunTemplate,
  renderPromptTemplate,
  type RunTemplate,
} from '../../template.js';

describe('run templates', () => {
  it('renders prompt templates with defaults and supplied values', () => {
    const template: RunTemplate = {
      templateId: 'template-design-review',
      title: 'Design review',
      targetPagelet: 'design',
      promptTemplate: 'Review {{ artifact }} for {{ audience }}. Severity: {{ severity }}.',
      variables: [
        { name: 'artifact', required: true },
        { name: 'audience', defaultValue: 'operators' },
        { name: 'severity', defaultValue: 'medium' },
      ],
      metadata: {
        category: 'review',
      },
      schemaVersion: RUN_PROTOCOL_SCHEMA_VERSION,
    };

    expect(instantiateRunTemplate(template, {
      values: {
        artifact: 'run console',
        severity: 'high',
      },
      metadata: {
        source: 'mobile',
      },
    })).toEqual({
      templateId: 'template-design-review',
      targetPagelet: 'design',
      prompt: 'Review run console for operators. Severity: high.',
      metadata: {
        category: 'review',
        source: 'mobile',
        runTemplateId: 'template-design-review',
      },
    });
  });

  it('rejects missing required variables', () => {
    const template: RunTemplate = {
      templateId: 'template-ask',
      title: 'Ask',
      targetPagelet: 'chat',
      promptTemplate: 'Answer {{ question }}.',
      variables: [{ name: 'question', required: true }],
      schemaVersion: RUN_PROTOCOL_SCHEMA_VERSION,
    };

    expect(() => instantiateRunTemplate(template)).toThrow('Missing required run template variable: question');
  });

  it('rejects unresolved placeholders even when they are not declared', () => {
    expect(() => renderPromptTemplate('Build {{ thing }}.', {})).toThrow('Missing run template value: thing');
  });
});
