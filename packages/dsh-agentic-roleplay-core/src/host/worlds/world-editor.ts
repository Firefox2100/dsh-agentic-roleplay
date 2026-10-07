import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { chmod, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { CharacterDefinition } from 'dsh-roleplay-model'
import type { ImageGenerationService } from 'dsh-ai-core'
import { InvalidEditProblems, type CharacterEdit, type FactionEdit, type NewRelationEdit, type PlaceEdit, type RelationChange, type RelationEntity, type ThingEdit, type WorldCharacter, type WorldRelation, type WorldState } from '../../shared/world-state.ts'
import { CHARACTERS_DIR, loadCharacters } from '../characters/load.ts'
import { CHARACTER_FILE_NAME, parseCharacterFile } from '../characters/character-file.ts'
import { subfolders } from '../folders.ts'
import { loadLocations } from '../locations/load.ts'
import { LOCATIONS_DIR } from '../locations/load.ts'
import { LOCATION_FILE_NAME, parseLocationFile } from '../locations/location-file.ts'
import { ITEMS_DIR, loadItems } from '../items/load.ts'
import { ITEM_FILE_NAME, parseItemFile } from '../items/item-file.ts'
import { FACTIONS_DIR, loadFactions } from '../factions/load.ts'
import { FACTION_FILE_NAME, parseFactionFile } from '../factions/faction-file.ts'
import { formatIssue } from '../validation.ts'
import { API_PREFIX } from '../../shared/worlds.ts'
import { referenceImagePath } from '../images/storage.ts'
import { generateReferenceImage } from '../images/generator.ts'

/** What of a world the editor needs: the folder it is in. */
export interface EditableWorld {
  id: string
  directory: string
}

type Json = Record<string, unknown>

function stateOf(world: EditableWorld, definition: CharacterDefinition, names: ReadonlyMap<string, string>): WorldCharacter {
  const { start } = definition
  const portrait = referenceImagePath(world.directory, { kind: 'character', localId: definition.id, ...(definition.visualIdentity?.globalId === undefined ? {} : { globalId: definition.visualIdentity.globalId }) })
  return {
    key: definition.id,
    name: definition.name,
    aliases: definition.aliases,
    role: definition.role,
    tier: definition.tier,
    kind: definition.kind,
    control: definition.role === 'playable' ? 'player' : 'agent',
    ...(definition.age === undefined ? {} : { age: definition.age }),
    ...(definition.gender === undefined ? {} : { gender: definition.gender }),
    ...(definition.pronouns === undefined ? {} : { pronouns: definition.pronouns }),
    summary: definition.summary,
    personality: definition.personality,
    background: definition.background,
    appearance: definition.appearance,
    speech: definition.speech,
    ...(definition.voice === undefined ? {} : { voice: definition.voice }),
    ...(definition.visualIdentity === undefined ? {} : { visualIdentity: definition.visualIdentity }),
    ...(existsSync(portrait) ? { portrait: `/${API_PREFIX}/worlds/state/character/portrait/file?id=${encodeURIComponent(world.id)}&key=${encodeURIComponent(definition.id)}&v=${statSync(portrait).mtimeMs}` } : {}),
    state: { publicState: start.publicState, innerState: start.innerState, activity: start.activity },
    ...(start.place === undefined ? {} : { place: { key: start.place.location, name: names.get(start.place.location) ?? start.place.location, ...(start.place.position === undefined ? {} : { position: start.place.position }) } }),
    goals: start.intents.map((intent, index) => ({ ref: String(index), name: intent.name, description: intent.description, status: intent.status, priority: intent.priority })),
  }
}

/** The characters of a world as they start, and the places they can start in. */
export async function readWorldEditor(world: EditableWorld): Promise<WorldState> {
  const [{ characters }, { locations }, { factions }] = await Promise.all([loadCharacters(world.directory), loadLocations(world.directory), loadFactions(world.directory)])
  const { items } = await loadItems(world.directory, { characters: characters.map(character => character.id), locations })
  const names = new Map(locations.map(location => [location.id, location.name]))
  const characterNames = new Map(characters.map(character => [character.id, character.name]))
  const itemNames = new Map(items.map(item => [item.id, item.name]))
  const holder = (item: (typeof items)[number]): string => item.start.kind === 'location' ? names.get(item.start.location) ?? item.start.location : item.start.kind === 'inside' ? itemNames.get(item.start.item) ?? item.start.item : characterNames.get(item.start.character) ?? item.start.character
  const entity = (kind: RelationEntity['kind'], key: string, name: string): RelationEntity => ({ kind, key, name })
  const characterEntity = (key: string) => entity('character', key, characterNames.get(key) ?? key)
  const factionNames = new Map(factions.map(faction => [faction.id, faction.name]))
  const relations: WorldRelation[] = []
  for (const character of characters) {
    for (const relation of character.relationships ?? []) relations.push({ key: relationKey('character', character.id, relation.to), kind: 'character', from: characterEntity(character.id), to: characterEntity(relation.to), label: relation.label, summary: relation.summary, familiarity: relation.familiarity, trust: relation.trust, affinity: relation.affinity, tension: relation.tension })
    for (const location of character.knowledge?.locations ?? []) relations.push({ key: relationKey('knowledge', character.id, 'location', location), kind: 'knowledge', from: characterEntity(character.id), to: entity('location', location, names.get(location) ?? location), observed: false })
    for (const item of character.knowledge?.items ?? []) relations.push({ key: relationKey('knowledge', character.id, 'item', item), kind: 'knowledge', from: characterEntity(character.id), to: entity('item', item, itemNames.get(item) ?? item), observed: false })
    for (const exit of character.knowledge?.exits ?? []) relations.push({ key: relationKey('knowledge', character.id, 'exit', exit.from, exit.to), kind: 'knowledge', from: characterEntity(character.id), to: entity('exit', `${exit.from}>${exit.to}`, `${names.get(exit.from) ?? exit.from} → ${names.get(exit.to) ?? exit.to}`), observed: false })
  }
  for (const location of locations) for (const exit of location.exits) relations.push({ key: relationKey('exit', location.id, exit.to), kind: 'exit', from: entity('location', location.id, location.name), to: entity('location', exit.to, names.get(exit.to) ?? exit.to), description: exit.description, ...(exit.travelSeconds === undefined ? {} : { travelSeconds: exit.travelSeconds }), state: exit.state, note: exit.note, oneWay: exit.oneWay })
  for (const faction of factions) {
    for (const member of faction.members) relations.push({ key: relationKey('membership', faction.id, member.character), kind: 'membership', from: characterEntity(member.character), to: entity('faction', faction.id, faction.name), role: member.role, rank: member.rank, status: member.status, public: member.public, commitment: member.commitment })
    for (const relation of faction.relationships) {
      const targetName = relation.to.kind === 'faction' ? factionNames.get(relation.to.id) ?? relation.to.id : characterNames.get(relation.to.id) ?? relation.to.id
      relations.push({ key: relationKey('social', 'faction', faction.id, relation.to.kind, relation.to.id), kind: 'social', from: entity('faction', faction.id, faction.name), to: entity(relation.to.kind, relation.to.id, targetName), label: relation.label, summary: relation.summary ?? '', familiarity: relation.familiarity ?? 0, trust: relation.trust ?? 0, affinity: relation.affinity ?? 0, tension: relation.tension ?? 0 })
    }
  }
  const worldDocument = JSON.parse(await readFile(join(world.directory, 'world.json'), 'utf8')) as Json
  const narrationVoice = typeof worldDocument['narration_voice'] === 'string' ? worldDocument['narration_voice'] : undefined
  return {
    ...(narrationVoice === undefined ? {} : { narrationVoice }),
    characters: characters.map(character => stateOf(world, character, names)),
    places: locations.map(location => ({ key: location.id, name: location.name, description: location.description, ...(location.parent === undefined ? {} : { parent: { key: location.parent, name: names.get(location.parent) ?? location.parent } }), features: location.features, ...(location.visualIdentity === undefined ? {} : { visualIdentity: location.visualIdentity }) })),
    things: items.map(item => ({ key: item.id, name: item.name, description: item.description, quantity: item.quantity, unique: item.unique, quality: item.quality, notable: item.notable, hidden: item.hidden, ...(item.wearable === undefined ? {} : { wearable: item.wearable }), ...(item.container === undefined ? {} : { containerState: item.container.state }), ...(item.owner === undefined ? {} : { owner: { key: item.owner, name: characterNames.get(item.owner) ?? item.owner } }), holder: holder(item), ...(item.visualIdentity === undefined ? {} : { visualIdentity: item.visualIdentity }) })),
    factions: factions.map(faction => ({ key: faction.id, name: faction.name, aliases: faction.aliases, summary: faction.summary, description: faction.description, values: faction.values, structure: faction.structure, state: { publicState: faction.start.publicState, innerState: faction.start.innerState }, goals: faction.start.goals.map((goal, index) => ({ ref: String(index), name: goal.name, description: goal.description, status: goal.status, priority: goal.priority })), members: faction.members.map(member => ({ ...member, name: characterNames.get(member.character) ?? member.character })), relationships: faction.relationships.map(relationship => ({ target: `${relationship.to.kind}:${relationship.to.id}`, label: relationship.label, summary: relationship.summary ?? '' })) })),
    relations,
  }
}

export async function editWorldNarrationVoice(world: EditableWorld, voice: string): Promise<WorldState> {
  const file = join(world.directory, 'world.json'); const text = await readFile(file, 'utf8'); const document = JSON.parse(text) as Json
  if (voice.trim() === '') delete document['narration_voice']; else document['narration_voice'] = voice.trim()
  await replaceFile(file, JSON.stringify(document, null, /^([ \t]+)"/m.exec(text)?.[1] ?? '  ') + (text.endsWith('\n') ? '\n' : ''))
  return await readWorldEditor(world)
}

const relationKey = (...parts: string[]): string => parts.map(part => encodeURIComponent(part)).join(':')
const relationParts = (key: string): string[] => key.split(':').map(part => decodeURIComponent(part))

/** The folder of a character by its id: the id is the folder's name unless the file says another. */
async function folderOf(worldDirectory: string, key: string): Promise<string | undefined> {
  const root = join(worldDirectory, CHARACTERS_DIR)
  for (const folder of await subfolders(root)) {
    try {
      const parsed = parseCharacterFile(await readFile(join(root, folder, CHARACTER_FILE_NAME), 'utf8'), folder)
      if (parsed.ok && parsed.value.id === key) return folder
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return undefined
}

const object = (parent: Json, key: string): Json => {
  const found = parent[key]
  if (typeof found === 'object' && found !== null && !Array.isArray(found)) return found as Json
  const made: Json = {}
  parent[key] = made
  return made
}

/** A blank optional text is taken out of the file instead of being written empty. */
function setOptional(target: Json, key: string, value: string | undefined): void {
  if (value === undefined) return
  if (value.trim() === '') delete target[key]
  else target[key] = value.trim()
}

/** Puts the edit into the document of a character file; the fields it does not name, and every field the editor does not know, stay as they are. */
function apply(document: Json, edit: CharacterEdit, problems: string[]): void {
  if (edit.name !== undefined) document['name'] = edit.name
  if (edit.aliases !== undefined) document['aliases'] = edit.aliases.map(alias => alias.trim()).filter(alias => alias !== '')
  for (const key of ['age', 'gender', 'pronouns'] as const) setOptional(document, key, edit[key])
  for (const key of ['role', 'tier', 'kind', 'summary', 'personality', 'background', 'appearance'] as const) if (edit[key] !== undefined) document[key] = edit[key]
  if (edit.visualIdentity === null) delete document['visual_identity']
  else if (edit.visualIdentity !== undefined) document['visual_identity'] = { description: edit.visualIdentity.description, tags: edit.visualIdentity.tags, negative_tags: edit.visualIdentity.negativeTags, ...(edit.visualIdentity.globalId === undefined ? {} : { global_id: edit.visualIdentity.globalId }) }
  if (edit.speech !== undefined) {
    const speech = object(document, 'speech')
    if (edit.speech.style !== undefined) speech['style'] = edit.speech.style
    if (edit.speech.examples !== undefined) speech['examples'] = edit.speech.examples.map(example => example.trim()).filter(example => example !== '')
  }
  setOptional(document, 'voice', edit.voice)
  const start = object(document, 'start')
  if (edit.state !== undefined) {
    if (edit.state.publicState !== undefined) start['public_state'] = edit.state.publicState
    if (edit.state.innerState !== undefined) start['inner_state'] = edit.state.innerState
    if (edit.state.activity !== undefined) start['activity'] = edit.state.activity
  }
  if (edit.place !== undefined) {
    if (start['location'] !== edit.place.location) delete start['feature']
    start['location'] = edit.place.location
    setOptional(start, 'position', edit.place.position ?? '')
  }
  if (edit.goals !== undefined) {
    const intents = Array.isArray(start['intents']) ? start['intents'] as Json[] : []
    for (const goal of edit.goals) {
      const intent = intents[Number(goal.ref)]
      if (intent === undefined || typeof intent !== 'object' || intent === null) { problems.push(`there is no goal "${goal.ref}"`); continue }
      if (goal.name !== undefined) intent['name'] = goal.name
      if (goal.description !== undefined) intent['description'] = goal.description
      if (goal.status !== undefined) intent['status'] = goal.status
      if (goal.priority !== undefined) intent['priority'] = goal.priority
    }
  }
}

/** Written in one step, so an interruption cannot leave a character file half written. */
async function replaceFile(file: string, text: string): Promise<void> {
  const temporary = join(dirname(file), `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    const { mode } = await stat(file)
    await writeFile(temporary, text, { mode })
    await chmod(temporary, mode)
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

/**
 * Change a character in a world's files: the file is read, changed and checked as a whole (it has to read as a valid character, and the place has to be a place of
 * the world) before it is written, so a refused edit changes nothing. Whatever the file holds that the editor does not know stays.
 * @throws {InvalidEditProblems} when the character is not there, or the result would not be a valid character.
 */
export async function editWorldCharacter(world: EditableWorld, key: string, edit: CharacterEdit): Promise<WorldState> {
  const folder = await folderOf(world.directory, key)
  if (folder === undefined) throw new InvalidEditProblems([`there is no character "${key}"`])
  const file = join(world.directory, CHARACTERS_DIR, folder, CHARACTER_FILE_NAME)
  const text = (await readFile(file, 'utf8')).replace(/^﻿/, '')
  const document = JSON.parse(text) as Json
  const problems: string[] = []
  if (edit.place !== undefined) {
    const { locations } = await loadLocations(world.directory)
    if (!locations.some(location => location.id === edit.place?.location)) problems.push(`there is no place "${edit.place.location}"`)
  }
  apply(document, edit, problems)
  const next = JSON.stringify(document, null, /^([ \t]+)"/m.exec(text)?.[1] ?? '  ') + (text.endsWith('\n') ? '\n' : '')
  const parsed = parseCharacterFile(next, folder)
  if (!parsed.ok) problems.push(...parsed.issues.map(formatIssue))
  if (problems.length > 0) throw new InvalidEditProblems(problems)
  await replaceFile(file, next)
  return await readWorldEditor(world)
}

async function entityFolder(worldDirectory: string, directory: string, fileName: string, key: string, parse: (text: string, fallback: string) => { ok: boolean; value?: { id: string } }): Promise<string | undefined> {
  for (const folder of await subfolders(join(worldDirectory, directory))) {
    try {
      const parsed = parse(await readFile(join(worldDirectory, directory, folder, fileName), 'utf8'), folder)
      if (parsed.ok && parsed.value?.id === key) return folder
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return undefined
}

function setVisualIdentity(document: Json, identity: PlaceEdit['visualIdentity'] | ThingEdit['visualIdentity']): void {
  if (identity === null) delete document['visual_identity']
  else if (identity !== undefined) document['visual_identity'] = { description: identity.description, tags: identity.tags, negative_tags: identity.negativeTags, ...(identity.globalId === undefined ? {} : { global_id: identity.globalId }) }
}

async function editEntityFile(world: EditableWorld, directory: string, fileName: string, key: string, parse: (text: string, fallback: string) => { ok: boolean; issues?: readonly { path: string; message: string }[] }, mutate: (document: Json) => void): Promise<WorldState> {
  const folder = await entityFolder(world.directory, directory, fileName, key, parse as never)
  if (folder === undefined) throw new InvalidEditProblems([`there is no entity "${key}"`])
  const file = join(world.directory, directory, folder, fileName)
  const text = (await readFile(file, 'utf8')).replace(/^﻿/, '')
  const document = JSON.parse(text) as Json
  mutate(document)
  const next = JSON.stringify(document, null, /^([ \t]+)"/m.exec(text)?.[1] ?? '  ') + (text.endsWith('\n') ? '\n' : '')
  const parsed = parse(next, folder)
  if (!parsed.ok) throw new InvalidEditProblems((parsed.issues ?? []).map(formatIssue))
  await replaceFile(file, next)
  return await readWorldEditor(world)
}

export async function editWorldPlace(world: EditableWorld, key: string, edit: PlaceEdit): Promise<WorldState> {
  return await editEntityFile(world, LOCATIONS_DIR, LOCATION_FILE_NAME, key, parseLocationFile, (document) => {
    if (edit.name !== undefined) document['name'] = edit.name
    if (edit.description !== undefined) document['description'] = edit.description
    if (edit.features !== undefined) document['features'] = edit.features.map(feature => ({ id: feature.key, name: feature.name, description: feature.description }))
    setVisualIdentity(document, edit.visualIdentity)
  })
}

export async function editWorldThing(world: EditableWorld, key: string, edit: ThingEdit): Promise<WorldState> {
  return await editEntityFile(world, ITEMS_DIR, ITEM_FILE_NAME, key, parseItemFile, (document) => {
    for (const field of ['name', 'description', 'quantity', 'quality', 'notable', 'hidden'] as const) if (edit[field] !== undefined) document[field] = edit[field]
    if (edit.containerState !== undefined) object(document, 'container')['state'] = edit.containerState
    setVisualIdentity(document, edit.visualIdentity)
  })
}

export async function editWorldFaction(world: EditableWorld, key: string, edit: FactionEdit): Promise<WorldState> {
  return await editEntityFile(world, FACTIONS_DIR, FACTION_FILE_NAME, key, parseFactionFile, (document) => {
    for (const field of ['name', 'aliases', 'summary', 'description', 'values', 'structure'] as const) if (edit[field] !== undefined) document[field] = edit[field]
    const start = object(document, 'start')
    if (edit.state?.publicState !== undefined) start['public_state'] = edit.state.publicState
    if (edit.state?.innerState !== undefined) start['inner_state'] = edit.state.innerState
    if (edit.goals !== undefined) {
      const goals = Array.isArray(start['goals']) ? start['goals'] as Json[] : []
      for (const goal of edit.goals) { const target = goals[Number(goal.ref)]; if (target === undefined) continue; for (const field of ['name', 'description', 'status', 'priority'] as const) if (goal[field] !== undefined) target[field] = goal[field] }
    }
  })
}

async function createWorldRelation(world: EditableWorld, edit: NewRelationEdit): Promise<WorldState> {
  if (edit.kind === 'character' || edit.kind === 'knowledge') {
    return await editEntityFile(world, CHARACTERS_DIR, CHARACTER_FILE_NAME, edit.from, parseCharacterFile, document => {
      if (edit.kind === 'character') {
        const relationships = Array.isArray(document['relationships']) ? document['relationships'] as Json[] : []
        if (relationships.some(entry => entry?.['to'] === edit.to)) throw new InvalidEditProblems(['that relationship already exists'])
        relationships.push({ to: edit.to, label: edit.label, summary: edit.summary ?? '', familiarity: edit.familiarity ?? 0, trust: edit.trust ?? 0, affinity: edit.affinity ?? 0, tension: edit.tension ?? 0 }); document['relationships'] = relationships
      } else {
        const knowledge = object(document, 'knowledge')
        const field = edit.toKind === 'location' ? 'locations' : edit.toKind === 'item' ? 'items' : 'exits'
        const entries = Array.isArray(knowledge[field]) ? knowledge[field] as unknown[] : []
        if (edit.toKind === 'exit') {
          const [from, to] = edit.to.split('>')
          if (from === undefined || to === undefined) throw new InvalidEditProblems(['the route key is invalid'])
          if (entries.some(entry => typeof entry === 'object' && entry !== null && (entry as Json)['from'] === from && (entry as Json)['to'] === to)) throw new InvalidEditProblems(['that knowledge relation already exists'])
          entries.push({ from, to })
        } else { if (entries.includes(edit.to)) throw new InvalidEditProblems(['that knowledge relation already exists']); entries.push(edit.to) }
        knowledge[field] = entries
      }
    })
  }
  if (edit.kind === 'exit') return await editEntityFile(world, LOCATIONS_DIR, LOCATION_FILE_NAME, edit.from, parseLocationFile, document => {
    const exits = Array.isArray(document['exits']) ? document['exits'] as Json[] : []
    if (exits.some(entry => entry?.['to'] === edit.to)) throw new InvalidEditProblems(['that route already exists'])
    exits.push({ to: edit.to, description: edit.description, ...(edit.travelSeconds === undefined ? {} : { travel_time_seconds: edit.travelSeconds }), state: edit.state ?? 'open', note: edit.note ?? '' }); document['exits'] = exits
  })
  const faction = edit.kind === 'membership' ? edit.to : edit.from
  if (edit.kind === 'social' && edit.fromKind !== 'faction') throw new InvalidEditProblems(['authored social relationships must start from a faction'])
  return await editEntityFile(world, FACTIONS_DIR, FACTION_FILE_NAME, faction, parseFactionFile, document => {
    if (edit.kind === 'membership') {
      const members = Array.isArray(document['members']) ? document['members'] as Json[] : []
      if (members.some(entry => entry?.['character'] === edit.from)) throw new InvalidEditProblems(['that membership already exists'])
      members.push({ character: edit.from, role: edit.role, rank: edit.rank ?? '', status: edit.status ?? 'active', public: edit.public ?? true, commitment: edit.commitment ?? 0.5 }); document['members'] = members
    } else {
      const relationships = Array.isArray(document['relationships']) ? document['relationships'] as Json[] : []
      if (relationships.some(entry => typeof entry?.['to'] === 'object' && entry['to'] !== null && (entry['to'] as Json)['kind'] === edit.toKind && (entry['to'] as Json)['id'] === edit.to)) throw new InvalidEditProblems(['that relationship already exists'])
      relationships.push({ to: { kind: edit.toKind, id: edit.to }, label: edit.label, summary: edit.summary ?? '', familiarity: edit.familiarity ?? 0, trust: edit.trust ?? 0, affinity: edit.affinity ?? 0, tension: edit.tension ?? 0 }); document['relationships'] = relationships
    }
  })
}

const isNewRelation = (edit: RelationChange): edit is NewRelationEdit => 'create' in edit && edit.create === true

export async function editWorldRelation(world: EditableWorld, edit: RelationChange): Promise<WorldState> {
  if (isNewRelation(edit)) return await createWorldRelation(world, edit)
  const parts = relationParts(edit.key)
  if (parts[0] !== edit.kind) throw new InvalidEditProblems(['the relation key does not match its kind'])
  if (edit.kind === 'character' || edit.kind === 'knowledge') {
    const character = parts[1]
    if (character === undefined) throw new InvalidEditProblems(['the relation key is invalid'])
    const folder = await folderOf(world.directory, character)
    if (folder === undefined) throw new InvalidEditProblems([`there is no character "${character}"`])
    return await editEntityFile(world, CHARACTERS_DIR, CHARACTER_FILE_NAME, character, parseCharacterFile, document => {
      if (edit.kind === 'character') {
        const target = parts[2]
        const relationships = Array.isArray(document['relationships']) ? document['relationships'] as Json[] : []
        const index = relationships.findIndex(entry => entry?.['to'] === target)
        if (index < 0) throw new InvalidEditProblems(['the relationship no longer exists'])
        if (edit.remove === true) relationships.splice(index, 1)
        else for (const field of ['label', 'summary', 'familiarity', 'trust', 'affinity', 'tension'] as const) if (edit[field] !== undefined) relationships[index]![field] = edit[field]
        document['relationships'] = relationships
      } else {
        const subjectKind = parts[2]; const one = parts[3]; const two = parts[4]
        const knowledge = object(document, 'knowledge')
        const field = subjectKind === 'location' ? 'locations' : subjectKind === 'item' ? 'items' : 'exits'
        const entries = Array.isArray(knowledge[field]) ? knowledge[field] as unknown[] : []
        const index = subjectKind === 'exit' ? entries.findIndex(entry => typeof entry === 'object' && entry !== null && (entry as Json)['from'] === one && (entry as Json)['to'] === two) : entries.indexOf(one)
        if (index < 0) throw new InvalidEditProblems(['the knowledge relation no longer exists'])
        entries.splice(index, 1); knowledge[field] = entries
      }
    })
  }
  if (edit.kind === 'exit') {
    const from = parts[1]; const to = parts[2]
    if (from === undefined || to === undefined) throw new InvalidEditProblems(['the exit key is invalid'])
    return await editEntityFile(world, LOCATIONS_DIR, LOCATION_FILE_NAME, from, parseLocationFile, document => {
      const exits = Array.isArray(document['exits']) ? document['exits'] as Json[] : []
      const index = exits.findIndex(entry => entry?.['to'] === to)
      if (index < 0) throw new InvalidEditProblems(['the exit no longer exists'])
      if (edit.remove === true) exits.splice(index, 1)
      else {
        for (const field of ['description', 'state', 'note'] as const) if (edit[field] !== undefined) exits[index]![field] = edit[field]
        if (edit.travelSeconds === null) delete exits[index]!['travel_time_seconds']
        else if (edit.travelSeconds !== undefined) exits[index]!['travel_time_seconds'] = edit.travelSeconds
      }
      document['exits'] = exits
    })
  }
  const faction = edit.kind === 'membership' ? parts[1] : parts[2]
  if (faction === undefined) throw new InvalidEditProblems(['the relation key is invalid'])
  return await editEntityFile(world, FACTIONS_DIR, FACTION_FILE_NAME, faction, parseFactionFile, document => {
    if (edit.kind === 'membership') {
      const character = parts[2]
      const members = Array.isArray(document['members']) ? document['members'] as Json[] : []
      const index = members.findIndex(entry => entry?.['character'] === character)
      if (index < 0) throw new InvalidEditProblems(['the membership no longer exists'])
      if (edit.remove === true) members.splice(index, 1)
      else for (const field of ['role', 'rank', 'status', 'public', 'commitment'] as const) if (edit[field] !== undefined) members[index]![field] = edit[field]
      document['members'] = members
    } else {
      const targetKind = parts[3]; const target = parts[4]
      const relationships = Array.isArray(document['relationships']) ? document['relationships'] as Json[] : []
      const index = relationships.findIndex(entry => typeof entry?.['to'] === 'object' && entry['to'] !== null && (entry['to'] as Json)['kind'] === targetKind && (entry['to'] as Json)['id'] === target)
      if (index < 0) throw new InvalidEditProblems(['the relationship no longer exists'])
      if (edit.remove === true) relationships.splice(index, 1)
      else for (const field of ['label', 'summary', 'familiarity', 'trust', 'affinity', 'tension'] as const) if (edit[field] !== undefined) relationships[index]![field] = edit[field]
      document['relationships'] = relationships
    }
  })
}

async function characterOf(world: EditableWorld, key: string): Promise<CharacterDefinition> {
  const { characters } = await loadCharacters(world.directory)
  const character = characters.find(candidate => candidate.id === key)
  if (character === undefined) throw new InvalidEditProblems([`there is no character "${key}"`])
  return character
}

/** Generate or replace the authored character's stable reference portrait. */
export async function generateWorldCharacterPortrait(world: EditableWorld, key: string, service: ImageGenerationService): Promise<WorldState> {
  const character = await characterOf(world, key)
  const identity = character.visualIdentity
  if (identity === undefined) throw new InvalidEditProblems([`${character.name} needs a visual identity before a portrait can be generated`])
  await generateReferenceImage(service, {
    root: world.directory,
    subject: { kind: 'character', localId: character.id, name: character.name, ...(identity.globalId === undefined ? {} : { globalId: identity.globalId }) },
    identity: { ...identity, subjectKind: 'character', subjectId: 0, version: 1, updatedAt: '' },
  })
  return await readWorldEditor(world)
}

/** Resolve a portrait through authored data so request parameters cannot select arbitrary files. */
export async function worldCharacterPortraitFile(world: EditableWorld, key: string): Promise<{ file: string; size: number }> {
  const character = await characterOf(world, key)
  const file = referenceImagePath(world.directory, { kind: 'character', localId: character.id, ...(character.visualIdentity?.globalId === undefined ? {} : { globalId: character.visualIdentity.globalId }) })
  return { file, size: (await stat(file)).size }
}
