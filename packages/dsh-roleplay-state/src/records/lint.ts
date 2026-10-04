import type { Exit, Location } from 'dsh-roleplay-model'
import { lookupKey } from '../sqlite/support.ts'
import { characterKey, locationKey, type RecordsTarget } from './edit.ts'

export type LintSeverity = 'error' | 'warning' | 'info'

export interface LintFinding {
  /** An error leaves the world inconsistent (nobody can get to a place, two characters share a name); a warning is something that should be fitted in; an info is only worth knowing. */
  severity: LintSeverity
  code: string
  subject: { kind: 'character' | 'location' | 'exit' | 'relationship'; key: string }
  message: string
}

export type LintTarget = Pick<RecordsTarget, 'characters' | 'locations' | 'placements' | 'relationships' | 'consolidation'>

/**
 * What is inconsistent or unfinished in the world's graph of places and characters. Things made up in
 * play and not fitted in yet are held to a stricter standard than what the world was written with: a
 * place that no one can reach or leave is an error for them, and a warning for the rest.
 */
export function lintWorld(target: LintTarget): LintFinding[] {
  const findings: LintFinding[] = []
  const pending = target.consolidation.pending()
  const newCharacters = new Set(pending.filter(item => item.kind === 'character').map(item => item.subjectId))
  const newPlaces = new Set(pending.filter(item => item.kind === 'location').map(item => item.subjectId))
  const places = target.locations.list()
  const exits = target.locations.allExits()
  const characters = target.characters.list()
  const relationships = target.relationships.list()
  const containers = new Set(places.flatMap(place => (place.parentId === undefined ? [] : [place.parentId])))
  const keyOfPlace = (place: Pick<Location, 'id' | 'sourceId'>): string => locationKey(place)
  const placeById = new Map(places.map(place => [place.id, place]))
  const strict = (isNew: boolean): LintSeverity => (isNew ? 'error' : 'warning')

  // Places.
  const outgoing = new Map<number, Exit[]>()
  const touched = new Set<number>()
  for (const exit of exits) {
    outgoing.set(exit.fromId, [...(outgoing.get(exit.fromId) ?? []), exit])
    touched.add(exit.fromId)
    touched.add(exit.toId)
  }
  const walkable = places.filter(place => !containers.has(place.id))
  if (walkable.length > 1) {
    for (const place of walkable) {
      if (!touched.has(place.id)) findings.push({ severity: strict(newPlaces.has(place.id)), code: 'location-no-exit', subject: { kind: 'location', key: keyOfPlace(place) }, message: `${place.name} has no way in or out, so no one can go there or leave it` })
    }
    const player = characters.find(character => character.control === 'player')
    const start = (player === undefined ? undefined : target.placements.get('character', player.id)?.locationId) ?? walkable[0]!.id
    const reached = new Set<number>([start])
    for (const queue = [start]; queue.length > 0;) {
      const at = queue.shift()!
      for (const exit of outgoing.get(at) ?? []) if (!reached.has(exit.toId)) { reached.add(exit.toId); queue.push(exit.toId) }
    }
    for (const place of walkable) {
      if (reached.has(place.id) || !touched.has(place.id)) continue
      findings.push({ severity: 'warning', code: 'location-unreachable', subject: { kind: 'location', key: keyOfPlace(place) }, message: `${place.name} cannot be reached from ${placeById.get(start)?.name ?? 'where the story is'} by any chain of exits` })
    }
  }
  for (const exit of exits) {
    if (exits.some(other => other.fromId === exit.toId && other.toId === exit.fromId)) continue
    const from = placeById.get(exit.fromId)
    const to = placeById.get(exit.toId)
    if (from === undefined || to === undefined) continue
    findings.push({ severity: 'info', code: 'exit-no-way-back', subject: { kind: 'exit', key: `${keyOfPlace(from)}->${keyOfPlace(to)}` }, message: `there is a way from ${from.name} to ${to.name} but none back` })
  }
  const sameName = new Map<string, Location[]>()
  for (const place of places) sameName.set(`${place.parentId ?? 0}:${lookupKey(place.name)}`, [...(sameName.get(`${place.parentId ?? 0}:${lookupKey(place.name)}`) ?? []), place])
  for (const group of sameName.values()) {
    if (group.length > 1) findings.push({ severity: 'error', code: 'duplicate-name', subject: { kind: 'location', key: keyOfPlace(group[1]!) }, message: `${group.length} places in the same place are called ${group[0]!.name}: ${group.map(keyOfPlace).join(', ')}` })
  }

  // Characters.
  const byName = new Map<string, typeof characters>()
  for (const character of characters) byName.set(lookupKey(character.name), [...(byName.get(lookupKey(character.name)) ?? []), character])
  for (const group of byName.values()) {
    if (group.length > 1) findings.push({ severity: 'error', code: 'duplicate-name', subject: { kind: 'character', key: characterKey(group[1]!) }, message: `${group.length} characters are called ${group[0]!.name}: ${group.map(characterKey).join(', ')}` })
  }
  for (const character of characters) {
    const key = characterKey(character)
    if (places.length > 0 && target.placements.get('character', character.id) === undefined) {
      findings.push({ severity: strict(newCharacters.has(character.id)), code: 'character-unplaced', subject: { kind: 'character', key }, message: `${character.name} is not in any place` })
    }
    if (newCharacters.has(character.id) && characters.length > 1 && !relationships.some(relation => relation.fromId === character.id || relation.toId === character.id)) {
      findings.push({ severity: 'warning', code: 'character-no-relationships', subject: { kind: 'character', key }, message: `${character.name} was made up and has no relationship with anyone yet` })
    }
  }
  for (const relation of relationships) {
    if (relationships.some(other => other.fromId === relation.toId && other.toId === relation.fromId)) continue
    const from = characters.find(character => character.id === relation.fromId)
    const to = characters.find(character => character.id === relation.toId)
    if (from === undefined || to === undefined) continue
    findings.push({ severity: 'info', code: 'relationship-one-sided', subject: { kind: 'relationship', key: `${characterKey(from)}->${characterKey(to)}` }, message: `${from.name} has a profile of ${to.name} (${relation.label}) but ${to.name} has none of ${from.name}` })
  }
  const order = { error: 0, warning: 1, info: 2 } as const
  return findings.sort((a, b) => order[a.severity] - order[b.severity])
}
