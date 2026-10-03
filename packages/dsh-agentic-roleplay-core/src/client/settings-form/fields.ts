import type { RequestOption } from 'dsh-ai-core'
import { SETTINGS_SPEC, type ChatSettings, type EmbeddingOptions, type EmbeddingValue } from '../../shared/settings.ts'

/** The settings the form offers, in the order shown. The rest are in the settings file. */
export const FORM_FIELDS = [
  { path: ['maxRounds'], kind: 'integer', label: 'maxRounds', help: 'maxRoundsHelp' },
  { path: ['memory', 'flaky'], kind: 'flag', label: 'flaky', help: 'flakyHelp' },
  { path: ['memory', 'recall'], kind: 'integer', label: 'recall', help: 'recallHelp' },
  { path: ['memory', 'lookup'], kind: 'flag', label: 'lookup', help: 'lookupHelp' },
  { path: ['memory', 'verify'], kind: 'flag', label: 'verify', help: 'verifyHelp' },
  { path: ['memory', 'backlogRounds'], kind: 'integer', label: 'backlogRounds', help: 'backlogRoundsHelp' },
  { path: ['context', 'limitTokens'], kind: 'integer', label: 'limitTokens', help: 'limitTokensHelp' },
  { path: ['context', 'retainRatio'], kind: 'percent', label: 'retainRatio', help: 'retainRatioHelp' },
] as const

export type FormField = (typeof FORM_FIELDS)[number]
export type Drafts = Record<string, string | boolean>

export const keyOf = (field: Pick<FormField, 'path'>): string => field.path.join('.')

type Node = Record<string, unknown>

function read(root: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((node, key) => (node as Node)[key], root)
}

/** The key of the draft of one request option of the embedding provider. */
export const optionKey = (option: Pick<RequestOption, 'key'>): string => `embedding.options.${option.key}`

/** What each setting of the form starts as, and each request option the embedding provider offers. */
export function toDrafts(settings: ChatSettings, options: readonly RequestOption[] = []): Drafts {
  const fixed = FORM_FIELDS.map((field) => {
    const value = read(settings, field.path)
    return [keyOf(field), field.kind === 'flag' ? value === true : field.kind === 'percent' ? String(Math.round((value as number) * 100)) : String(value)] as const
  })
  const requested = options.map((option) => {
    const value = settings.embedding.options[option.key]
    return [optionKey(option), option.type === 'boolean' ? value === true : value === undefined ? '' : String(value)] as const
  })
  return Object.fromEntries([...fixed, ...requested])
}

/** The bounds of a field as the form shows them: percentages for a share. */
export function boundsOf(field: FormField): { min: number; max: number } {
  const spec = read(SETTINGS_SPEC, field.path) as { min?: number; max?: number }
  return field.kind === 'percent' ? { min: Math.round((spec.min ?? 0) * 100), max: Math.round((spec.max ?? 1) * 100) } : { min: spec.min ?? 0, max: spec.max ?? 0 }
}

/** Whether a draft can be saved: the keys of the values that cannot. */
export function problemsOf(drafts: Drafts, options: readonly RequestOption[] = []): Set<string> {
  const bad = new Set<string>()
  for (const option of options) {
    const draft = drafts[optionKey(option)]
    if (option.type === 'boolean' || option.type === 'string' || typeof draft !== 'string' || draft.trim() === '') continue
    const value = Number(draft)
    if (!Number.isFinite(value) || (option.type === 'integer' && !Number.isInteger(value)) || (option.min !== undefined && value < option.min) || (option.max !== undefined && value > option.max)) bad.add(optionKey(option))
  }
  for (const field of FORM_FIELDS) {
    if (field.kind === 'flag') continue
    const draft = drafts[keyOf(field)]
    const value = typeof draft === 'string' && draft.trim() !== '' ? Number(draft) : Number.NaN
    const { min, max } = boundsOf(field)
    if (!Number.isFinite(value) || value < min || value > max || (field.kind !== 'percent' && !Number.isInteger(value))) bad.add(keyOf(field))
  }
  return bad
}

/** The value of a request option as typed, or nothing when it is left empty (the provider's own setting then applies). */
function valueOf(option: RequestOption, draft: string | boolean | undefined): EmbeddingValue | undefined {
  if (option.type === 'boolean') return draft === true
  if (typeof draft !== 'string' || draft.trim() === '') return undefined
  return option.type === 'string' ? draft.trim() : Number(draft)
}

/** The settings with the form's values put over the ones it does not show; options it does not offer are left as they are. */
export function fromDrafts(base: ChatSettings, drafts: Drafts, options: readonly RequestOption[] = []): ChatSettings {
  const next = structuredClone(base) as unknown as Node
  const chosen: EmbeddingOptions = { ...base.embedding.options }
  for (const option of options) {
    const value = valueOf(option, drafts[optionKey(option)])
    if (value === undefined) delete chosen[option.key]
    else chosen[option.key] = value
  }
  ;(next['embedding'] as Node)['options'] = chosen
  for (const field of FORM_FIELDS) {
    const draft = drafts[keyOf(field)]
    const value = field.kind === 'flag' ? draft === true : field.kind === 'percent' ? Number(draft) / 100 : Number(draft)
    const parent = field.path.slice(0, -1).reduce<Node>((node, key) => node[key] as Node, next)
    parent[field.path.at(-1)!] = value
  }
  return next as unknown as ChatSettings
}
