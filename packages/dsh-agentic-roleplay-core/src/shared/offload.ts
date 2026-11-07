/** The kinds of model a story uses that may have to share one machine's memory. `main` is whatever model the chat itself is set to. */
export const OFFLOAD_ROLES = ['main', 'embedding', 'reranker', 'decision', 'image', 'speech'] as const
export type OffloadRole = (typeof OFFLOAD_ROLES)[number]

/** Where a model is served: the language model route on its server, and the model's name there. */
export interface OffloadModel {
  route: string
  model: string
}

/**
 * Which models cannot be loaded together. Each group lists roles that never stay resident side by side: before one of them is used,
 * the others are unloaded. Without groups nothing is ever unloaded.
 */
export interface OffloadConfig {
  /** The server and name of each role but `main`, which follows the chat's own model. */
  models: Partial<Record<Exclude<OffloadRole, 'main'>, OffloadModel>>
  groups: OffloadRole[][]
}

export const DEFAULT_OFFLOAD: OffloadConfig = { models: {}, groups: [] }

const isRole = (value: unknown): value is OffloadRole => OFFLOAD_ROLES.includes(value as OffloadRole)
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** The configuration as written, brought to its shape: unknown roles and blank entries are dropped, a group lists each role once and has at least two. */
export function offloadOf(value: unknown): OffloadConfig {
  const row = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const models: OffloadConfig['models'] = {}
  const given = (typeof row['models'] === 'object' && row['models'] !== null ? row['models'] : {}) as Record<string, unknown>
  for (const role of OFFLOAD_ROLES) {
    if (role === 'main') continue
    const entry = given[role]
    if (typeof entry !== 'object' || entry === null) continue
    const route = text((entry as Record<string, unknown>)['route'])
    const model = text((entry as Record<string, unknown>)['model'])
    if (route !== '' || model !== '') models[role] = { route, model }
  }
  const groups = (Array.isArray(row['groups']) ? row['groups'] : [])
    .map(group => OFFLOAD_ROLES.filter(role => Array.isArray(group) && group.some(member => isRole(member) && member === role)))
    .filter(group => group.length >= 2)
  return { models, groups }
}

/** The roles that may not be loaded together with `role`. */
export function conflictsOf(config: OffloadConfig, role: OffloadRole): OffloadRole[] {
  const others = new Set<OffloadRole>()
  for (const group of config.groups) if (group.includes(role)) for (const member of group) if (member !== role) others.add(member)
  return [...others]
}

export type OffloadProblem = { role: Exclude<OffloadRole, 'main'>; missing: 'route' | 'model' }

/** What stops the setting from working: a role in a group needs the route and the model it is served as. The first one found, or none. */
export function offloadProblem(config: OffloadConfig): OffloadProblem | undefined {
  for (const role of OFFLOAD_ROLES) {
    if (role === 'main' || !config.groups.some(group => group.includes(role))) continue
    const model = config.models[role]
    if (model === undefined || model.route === '') return { role, missing: 'route' }
    if (model.model === '') return { role, missing: 'model' }
  }
  return undefined
}
