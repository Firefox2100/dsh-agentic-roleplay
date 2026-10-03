import { SETTINGS_SPEC, type ChatSettings } from '../../shared/settings.ts'

/** The settings the form offers, in the order shown. The rest are in the settings file. */
export const FORM_FIELDS = [
  { path: ['maxRounds'], kind: 'integer', label: 'maxRounds', help: 'maxRoundsHelp' },
  { path: ['memory', 'flaky'], kind: 'flag', label: 'flaky', help: 'flakyHelp' },
  { path: ['memory', 'recall'], kind: 'integer', label: 'recall', help: 'recallHelp' },
  { path: ['memory', 'lookup'], kind: 'flag', label: 'lookup', help: 'lookupHelp' },
  { path: ['memory', 'verify'], kind: 'flag', label: 'verify', help: 'verifyHelp' },
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

/** What each setting of the form starts as. */
export function toDrafts(settings: ChatSettings): Drafts {
  return Object.fromEntries(FORM_FIELDS.map((field) => {
    const value = read(settings, field.path)
    return [keyOf(field), field.kind === 'flag' ? value === true : field.kind === 'percent' ? String(Math.round((value as number) * 100)) : String(value)]
  }))
}

/** The bounds of a field as the form shows them: percentages for a share. */
export function boundsOf(field: FormField): { min: number; max: number } {
  const spec = read(SETTINGS_SPEC, field.path) as { min?: number; max?: number }
  return field.kind === 'percent' ? { min: Math.round((spec.min ?? 0) * 100), max: Math.round((spec.max ?? 1) * 100) } : { min: spec.min ?? 0, max: spec.max ?? 0 }
}

/** Whether a draft can be saved. */
export function problemsOf(drafts: Drafts): Set<string> {
  const bad = new Set<string>()
  for (const field of FORM_FIELDS) {
    if (field.kind === 'flag') continue
    const draft = drafts[keyOf(field)]
    const value = typeof draft === 'string' && draft.trim() !== '' ? Number(draft) : Number.NaN
    const { min, max } = boundsOf(field)
    if (!Number.isFinite(value) || value < min || value > max || (field.kind !== 'percent' && !Number.isInteger(value))) bad.add(keyOf(field))
  }
  return bad
}

/** The settings with the form's values put over the ones it does not show. */
export function fromDrafts(base: ChatSettings, drafts: Drafts): ChatSettings {
  const next = structuredClone(base) as unknown as Node
  for (const field of FORM_FIELDS) {
    const draft = drafts[keyOf(field)]
    const value = field.kind === 'flag' ? draft === true : field.kind === 'percent' ? Number(draft) / 100 : Number(draft)
    const parent = field.path.slice(0, -1).reduce<Node>((node, key) => node[key] as Node, next)
    parent[field.path.at(-1)!] = value
  }
  return next as unknown as ChatSettings
}
