import type { SettingsFieldSpec } from '@deepseek-ai/dsh-client-ui-primitives'
import { OFFLOAD_ROLES, offloadOf, offloadProblem, type OffloadConfig, type OffloadProblem, type OffloadRole } from '../../shared/offload.ts'

/** The roles that are served as a model of their own; `main` is the chat's. */
export const SERVED_ROLES = OFFLOAD_ROLES.filter((role): role is Exclude<OffloadRole, 'main'> => role !== 'main')

export interface OffloadDraft {
  models: Partial<Record<Exclude<OffloadRole, 'main'>, { route: string; model: string }>>
  /** As being edited: a group may still have fewer than two roles. */
  groups: OffloadRole[][]
}

const roleOf = (value: unknown): value is OffloadRole => OFFLOAD_ROLES.includes(value as OffloadRole)

/** The draft of the setting is its JSON text, written only by the form; what is not a role or a text is left out. */
export function offloadDraftOf(text: string): OffloadDraft {
  let value: unknown
  try { value = JSON.parse(text === '' ? '{}' : text) } catch { value = {} }
  const row = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const given = (typeof row['models'] === 'object' && row['models'] !== null ? row['models'] : {}) as Record<string, unknown>
  const models: OffloadDraft['models'] = {}
  for (const role of SERVED_ROLES) {
    const entry = given[role]
    if (typeof entry !== 'object' || entry === null) continue
    const { route, model } = entry as Record<string, unknown>
    models[role] = { route: typeof route === 'string' ? route : '', model: typeof model === 'string' ? model : '' }
  }
  const groups = (Array.isArray(row['groups']) ? row['groups'] : []).map(group => (Array.isArray(group) ? group.filter(roleOf) : []))
  return { models, groups }
}

export const offloadProblemOf = (draft: OffloadDraft): OffloadProblem | undefined => offloadProblem(offloadOf(draft))

export const offloadField: SettingsFieldSpec = {
  field: 'offload',
  format: value => JSON.stringify(offloadOf(value)),
  parse: (text) => {
    const config: OffloadConfig = offloadOf(offloadDraftOf(text))
    if (offloadProblem(config) !== undefined) return undefined
    return config.groups.length === 0 ? { kind: 'clear' } : { kind: 'set', value: config }
  },
}
