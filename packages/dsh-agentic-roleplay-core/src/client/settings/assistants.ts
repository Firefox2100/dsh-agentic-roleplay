import type { SettingsFieldSpec } from '@deepseek-ai/dsh-client-ui-primitives'

/** The settings of the helper agents of imports and authoring: each is one field of the plugin's configuration, written only when it differs from the default. */
export const ASSISTANT_FIELDS = [
  { field: 'importReasoning', group: 'assistants', kind: 'text', placeholder: 'off' },
  { field: 'childReasoning', group: 'assistants', kind: 'text', placeholder: 'off' },
  { field: 'importModel', group: 'assistants', kind: 'text', placeholder: 'provider/model' },
  { field: 'importTemperature', group: 'assistants', kind: 'number', min: 0, max: 2, placeholder: '0.2' },
  { field: 'importStructuredOutput', group: 'assistants', kind: 'choice', choices: ['tool', 'schema'], labels: ['importStructuredTool', 'importStructuredSchema'], placeholder: 'tool' },
  { field: 'importMaxTokens', group: 'assistants', kind: 'integer', min: 0, max: 1000000, placeholder: '0' },
  { field: 'importVariablesPerRequest', group: 'assistants', kind: 'integer', min: 5, max: 500, placeholder: '25' },
  { field: 'importTimeoutMinutes', group: 'assistants', kind: 'integer', min: 0, max: 240, placeholder: '15' },
  { field: 'importConcurrency', group: 'assistants', kind: 'integer', min: 1, max: 16, placeholder: '4' },
  { field: 'importDecisions', group: 'assistants', kind: 'choice', choices: ['llm', 'decision'], labels: ['importDecisionLlm', 'importDecisionModel'], placeholder: 'llm' },
  { field: 'importConfidence', group: 'assistants', kind: 'number', min: 0, max: 1, placeholder: '0.7' },
  { field: 'authoringApproval', group: 'assistants', kind: 'choice', choices: ['ask', 'auto'], labels: ['authoringApprovalAsk', 'authoringApprovalAuto'], placeholder: 'ask' },
  { field: 'importMaxUploadBytes', group: 'limits', kind: 'integer', min: 1024, max: 4294967296, placeholder: '104857600' },
  { field: 'catalogueMaxBytes', group: 'limits', kind: 'integer', min: 1024, max: 4294967296, placeholder: '268435456' },
  { field: 'catalogueTrashDays', group: 'limits', kind: 'integer', min: 0, max: 3650, placeholder: '30' },
] as const

export type AssistantField = (typeof ASSISTANT_FIELDS)[number]['field']
export type AssistantSettings = Partial<Record<AssistantField, string | number>>

/** A draft is empty (the default), or a value the host accepts; anything else cannot be saved. */
function parseDraft(spec: (typeof ASSISTANT_FIELDS)[number], draft: string): ReturnType<SettingsFieldSpec['parse']> {
  const text = draft.trim()
  if (text === '') return { kind: 'clear' }
  if (spec.kind === 'text') return { kind: 'set', value: text }
  if (spec.kind === 'choice') return (spec.choices as readonly string[]).includes(text) ? { kind: 'set', value: text } : undefined
  const number = Number(text)
  if (!Number.isFinite(number) || number < spec.min || number > spec.max) return undefined
  if (spec.kind === 'integer' && !Number.isInteger(number)) return undefined
  return { kind: 'set', value: number }
}

export const assistantFields: SettingsFieldSpec[] = ASSISTANT_FIELDS.map(spec => ({
  field: spec.field,
  format: value => (typeof value === 'string' || typeof value === 'number' ? String(value) : ''),
  parse: draft => parseDraft(spec, draft),
}))
