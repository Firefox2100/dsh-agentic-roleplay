import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorldProblem } from '../worlds/world-check.ts'
import { atomicWrite } from '../atomic-write.ts'

/** A field the import dropped because its value could not be used, kept so a person can put it back. */
export interface Repair {
  file: string
  field: string
  value: unknown
  because: string
}

const ENTITY_FILE = /^(characters|locations|factions|items|lore)\/[^/]+\/(character|location|faction|item|lore)\.json$/
/** Fields a document cannot do without, and fields that tie it to others: never dropped, whatever the problem says. */
const KEPT = new Set(['id', 'name', 'role', 'kind', 'tier', 'from', 'to', 'parent', 'summary'])
const ABOUT_VALUE = /^(must be|is longer than|has more than|is not one of|must not|cannot be)/
const STEP = /([^.[\]]+)|\[(\d+)\]/g

const stepsOf = (field: string): (string | number)[] => [...field.matchAll(STEP)].map(match => (match[2] === undefined ? match[1]! : Number(match[2])))

/** Removes what `steps` names; false when it is not there. */
function remove(root: unknown, steps: readonly (string | number)[]): { value: unknown } | undefined {
  let at = root as Record<string | number, unknown> | undefined
  for (const step of steps.slice(0, -1)) {
    at = at?.[step] as Record<string | number, unknown> | undefined
    if (typeof at !== 'object' || at === null) return undefined
  }
  const last = steps.at(-1)!
  if (typeof at !== 'object' || at === null || !(last in at)) return undefined
  const value = at[last]
  if (Array.isArray(at) && typeof last === 'number') at.splice(last, 1)
  else delete at[last]
  return { value }
}

/**
 * Mends what the world check refused, one field at a time and only where that is safe: an optional field of an entity whose value cannot be used (wrong type, too long, not one of the
 * allowed words) is dropped. A missing required field, a name, an id or a link to another entity is never touched: those stay problems for a person or the assistant. Returns what was dropped, with the values.
 */
export async function repairFields(directory: string, problems: readonly WorldProblem[]): Promise<Repair[]> {
  const repairs: Repair[] = []
  const byFile = new Map<string, { field: string; because: string }[]>()
  for (const problem of problems) {
    if (!ENTITY_FILE.test(problem.where)) continue
    const split = problem.message.indexOf(': ')
    if (split < 0) continue
    const field = problem.message.slice(0, split)
    const because = problem.message.slice(split + 2)
    if (!/^[\w.[\]]+$/.test(field) || !ABOUT_VALUE.test(because) || KEPT.has(stepsOf(field)[0] as string)) continue
    byFile.set(problem.where, [...byFile.get(problem.where) ?? [], { field, because }])
  }
  for (const [file, fields] of byFile) {
    const document = JSON.parse(await readFile(join(directory, file), 'utf8')) as unknown
    // later positions first, so removing one element does not move the next
    for (const { field, because } of fields.sort((a, b) => b.field.localeCompare(a.field, undefined, { numeric: true }))) {
      const dropped = remove(document, stepsOf(field))
      if (dropped !== undefined) repairs.push({ file, field, value: dropped.value, because })
    }
    if (repairs.some(repair => repair.file === file)) await atomicWrite(join(directory, file), `${JSON.stringify(document, null, 2)}\n`)
  }
  return repairs
}
