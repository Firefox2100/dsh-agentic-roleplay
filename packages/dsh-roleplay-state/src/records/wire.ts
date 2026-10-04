import type { JsonSchemaNode, ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import {
  ACCURACIES, CHARACTER_KINDS, CHARACTER_TIERS, CONTAINER_STATES, EXIT_STATES, IMPORTANCE_MAX, IMPORTANCE_MIN, MEMORY_KINDS, PERCEPTION_MODES,
  type Accuracy, type CharacterKind, type CharacterTier, type ContainerState, type ExitState, type MemoryKind, type PerceptionMode, type Slot,
} from 'dsh-roleplay-model'
import { InvalidEditError } from '../errors.ts'
import type {
  BeliefEdit, CharacterMove, EventEdit, ExitChange, ItemChange, ItemEditSpec, NewBelief, NewCharacterSpec, NewEvent, NewExit, NewExitBetween, NewItemSpec, NewPlace,
  PerceivedBy, PerceptionAddition, PerceptionEdit, PlaceEdit, RecordsEdit, RelationshipRetraction, RelationshipSet, StatePatch,
} from './edit-types.ts'
import { ITEM_ACTIONS, type ItemAction } from './items.ts'

type Wire = Record<string, unknown>
const isObject = (value: unknown): value is Wire => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Read an edit from the JSON models write (snake_case), the one wire format of the
 * keeper's output and of the write tools.
 * @throws {InvalidEditError} when it is not shaped as an edit.
 */
export function parseRecordsEdit(value: unknown): RecordsEdit {
  const problems: string[] = []
  if (!isObject(value)) throw new InvalidEditError(['the edit must be an object'])
  const array = (key: string): Wire[] => {
    const entries = value[key]
    if (entries === undefined || entries === null) return []
    if (!Array.isArray(entries)) { problems.push(`${key} must be a list`); return [] }
    return entries.flatMap((entry, index) => {
      if (isObject(entry)) return [entry]
      problems.push(`${key}[${index}] must be an object`)
      return []
    })
  }
  const numbers = (key: string): number[] => {
    const entries = value[key]
    if (entries === undefined || entries === null) return []
    if (!Array.isArray(entries) || entries.some(entry => typeof entry !== 'number')) { problems.push(`${key} must be a list of numbers`); return [] }
    return entries as number[]
  }
  const strings = (entry: Wire, key: string): string[] | undefined => {
    const found = entry[key]
    if (found === undefined || found === null) return undefined
    if (!Array.isArray(found) || found.some(item => typeof item !== 'string')) { problems.push(`${key} must be a list of text`); return undefined }
    return found as string[]
  }
  const text = (entry: Wire, key: string): string | undefined => (typeof entry[key] === 'string' ? entry[key] : undefined)
  const num = (entry: Wire, key: string): number | undefined => (typeof entry[key] === 'number' ? entry[key] : undefined)
  const perceived = (entry: Wire): PerceivedBy[] | undefined => {
    const found = entry['perceived_by']
    if (found === undefined || found === null) return undefined
    if (!Array.isArray(found)) { problems.push('perceived_by must be a list'); return undefined }
    return found.filter(isObject).map(item => ({
      character: text(item, 'character') ?? '', mode: (text(item, 'mode') ?? '') as PerceptionMode,
      ...(text(item, 'content') === undefined ? {} : { content: text(item, 'content')! }),
      ...(text(item, 'gist') === undefined ? {} : { gist: text(item, 'gist')! }),
      ...(text(item, 'accuracy') === undefined ? {} : { accuracy: text(item, 'accuracy') as Accuracy }),
    }))
  }
  const bool = (entry: Wire, key: string): boolean | undefined => (typeof entry[key] === 'boolean' ? entry[key] : undefined)
  const featuresOf = (entry: Wire): { key: string; name: string; description?: string }[] | undefined => {
    const found = entry['features']
    if (found === undefined || found === null) return undefined
    if (!Array.isArray(found)) { problems.push('features must be a list'); return undefined }
    return found.filter(isObject).map(item => ({ key: text(item, 'key') ?? '', name: text(item, 'name') ?? '', ...(text(item, 'description') === undefined ? {} : { description: text(item, 'description')! }) }))
  }
  const defined = <T>(entry: object): T => Object.fromEntries(Object.entries(entry).filter(([, field]) => field !== undefined)) as T

  const turn = num(value, 'turn')
  const edit: RecordsEdit = {
    turn: turn ?? 0,
    states: array('states').map((entry): StatePatch => defined<StatePatch>({
      character: text(entry, 'character') ?? '', publicState: text(entry, 'public_state'), innerState: text(entry, 'inner_state'), activity: text(entry, 'activity'),
      emotion: isObject(entry['emotion']) ? { valence: num(entry['emotion'], 'valence') ?? Number.NaN, arousal: num(entry['emotion'], 'arousal') ?? Number.NaN, dominance: num(entry['emotion'], 'dominance') ?? Number.NaN } : undefined,
    })),
    events: array('events').map((entry): NewEvent => defined<NewEvent>({
      turn: num(entry, 'turn') ?? 0, round: num(entry, 'round') ?? 0, text: text(entry, 'text') ?? '', importance: num(entry, 'importance') ?? 0,
      tags: strings(entry, 'tags'), involves: strings(entry, 'involves'), perceivedBy: perceived(entry), location: text(entry, 'location'), items: strings(entry, 'items'),
    })),
    eventEdits: array('event_edits').map((entry): EventEdit => defined<EventEdit>({
      id: num(entry, 'id') ?? 0, text: text(entry, 'text'), importance: num(entry, 'importance'), tags: strings(entry, 'tags'), involves: strings(entry, 'involves'), perceivedBy: perceived(entry), location: text(entry, 'location'),
    })),
    eventRetractions: numbers('event_retractions'),
    perceptionEdits: array('perception_edits').map((entry): PerceptionEdit => defined<PerceptionEdit>({
      id: num(entry, 'id') ?? 0, mode: text(entry, 'mode') as PerceptionMode | undefined, content: text(entry, 'content'), gist: text(entry, 'gist'), accuracy: text(entry, 'accuracy') as Accuracy | undefined,
    })),
    perceptionsAdded: array('perceptions_added').map((entry): PerceptionAddition => defined<PerceptionAddition>({
      event: num(entry, 'event') ?? 0, character: text(entry, 'character') ?? '', mode: (text(entry, 'mode') ?? '') as PerceptionMode,
      content: text(entry, 'content'), gist: text(entry, 'gist'), accuracy: text(entry, 'accuracy') as Accuracy | undefined,
    })),
    characters: array('characters').map((entry): NewCharacterSpec => defined<NewCharacterSpec>({
      key: text(entry, 'key') ?? '', name: text(entry, 'name') ?? '', aliases: strings(entry, 'aliases'), age: text(entry, 'age'), gender: text(entry, 'gender'), pronouns: text(entry, 'pronouns'),
      kind: text(entry, 'kind') as CharacterKind | undefined, tier: text(entry, 'tier') as CharacterTier | undefined, summary: text(entry, 'summary') ?? '',
      personality: text(entry, 'personality'), background: text(entry, 'background'), appearance: text(entry, 'appearance'), note: text(entry, 'note'),
      speech: isObject(entry['speech']) ? defined<NonNullable<NewCharacterSpec['speech']>>({ style: text(entry['speech'], 'style') ?? '', examples: strings(entry['speech'], 'examples') }) : undefined,
      state: isObject(entry['state']) ? defined<NonNullable<NewCharacterSpec['state']>>({ publicState: text(entry['state'], 'public_state'), innerState: text(entry['state'], 'inner_state'), activity: text(entry['state'], 'activity') }) : undefined,
      place: isObject(entry['place']) ? defined<NonNullable<NewCharacterSpec['place']>>({ location: text(entry['place'], 'location') ?? '', position: text(entry['place'], 'position'), feature: text(entry['place'], 'feature') }) : undefined,
    })),
    items: array('items').map((entry): NewItemSpec => defined<NewItemSpec>({
      key: text(entry, 'key') ?? '', name: text(entry, 'name') ?? '', description: text(entry, 'description'), quantity: num(entry, 'quantity'), unique: bool(entry, 'unique'),
      quality: text(entry, 'quality'), notable: bool(entry, 'notable'), hidden: bool(entry, 'hidden'), wearable: text(entry, 'wearable'), owner: text(entry, 'owner'), note: text(entry, 'note'),
      container: isObject(entry['container']) ? defined<NonNullable<NewItemSpec['container']>>({ state: text(entry['container'], 'state') as ContainerState | undefined, openedBy: strings(entry['container'], 'opened_by') }) : undefined,
      at: isObject(entry['at']) ? defined<NonNullable<NewItemSpec['at']>>({ location: text(entry['at'], 'location') ?? '', position: text(entry['at'], 'position'), feature: text(entry['at'], 'feature') }) : undefined,
      heldBy: text(entry, 'held_by'), wornBy: text(entry, 'worn_by'), wornPosition: text(entry, 'worn_position'), inside: text(entry, 'inside'), insidePosition: text(entry, 'inside_position'),
    })),
    slots: array('slots').map((entry): Slot => ({ id: text(entry, 'id') ?? '', name: text(entry, 'name') ?? '', capacity: num(entry, 'capacity') ?? 0 })),
    itemChanges: array('item_changes').map((entry): ItemChange => defined<ItemChange>({
      character: text(entry, 'character') ?? '', item: text(entry, 'item') ?? '', action: (text(entry, 'action') ?? '') as ItemAction, to: text(entry, 'to'), slot: text(entry, 'slot'),
      quantity: num(entry, 'quantity'), position: text(entry, 'position'), feature: text(entry, 'feature'), with: text(entry, 'with'), exit: text(entry, 'exit'), forced: bool(entry, 'forced'),
    })),
    itemEdits: array('item_edits').map((entry): ItemEditSpec => defined<ItemEditSpec>({
      item: text(entry, 'item') ?? '', description: text(entry, 'description'), quality: text(entry, 'quality'), quantity: num(entry, 'quantity'), notable: bool(entry, 'notable'),
      hidden: bool(entry, 'hidden'), state: text(entry, 'state') as ContainerState | undefined, owner: text(entry, 'owner'), openedBy: strings(entry, 'opened_by'),
    })),
    places: array('places').map((entry): NewPlace => defined<NewPlace>({
      key: text(entry, 'key') ?? '', name: text(entry, 'name') ?? '', description: text(entry, 'description'), parent: text(entry, 'parent'), features: featuresOf(entry), note: text(entry, 'note'),
      exits: Array.isArray(entry['exits']) ? entry['exits'].filter(isObject).map((item): NewExit => defined<NewExit>({
        to: text(item, 'to') ?? '', description: text(item, 'description'), oneWay: bool(item, 'one_way'), backDescription: text(item, 'back_description'),
        travelSeconds: num(item, 'travel_time_seconds'), state: text(item, 'state') as ExitState | undefined, note: text(item, 'note'),
      })) : undefined,
    })),
    exits: array('exits').map((entry): NewExitBetween => defined<NewExitBetween>({
      from: text(entry, 'from') ?? '', to: text(entry, 'to') ?? '', description: text(entry, 'description'), oneWay: bool(entry, 'one_way'), backDescription: text(entry, 'back_description'),
      travelSeconds: num(entry, 'travel_time_seconds'), state: text(entry, 'state') as ExitState | undefined, note: text(entry, 'note'),
    })),
    relationships: array('relationships').map((entry): RelationshipSet => defined<RelationshipSet>({
      from: text(entry, 'from') ?? '', to: text(entry, 'to') ?? '', label: text(entry, 'label'), summary: text(entry, 'summary'),
      familiarity: num(entry, 'familiarity'), trust: num(entry, 'trust'), affinity: num(entry, 'affinity'), tension: num(entry, 'tension'),
    })),
    relationshipRetractions: array('relationship_retractions').map((entry): RelationshipRetraction => ({ from: text(entry, 'from') ?? '', to: text(entry, 'to') ?? '' })),
    placeEdits: array('place_edits').map((entry): PlaceEdit => defined<PlaceEdit>({ place: text(entry, 'place') ?? '', name: text(entry, 'name'), description: text(entry, 'description'), features: featuresOf(entry) })),
    exitChanges: array('exit_changes').map((entry): ExitChange => defined<ExitChange>({
      from: text(entry, 'from') ?? '', to: text(entry, 'to') ?? '', state: text(entry, 'state') as ExitState | undefined, description: text(entry, 'description'), note: text(entry, 'note'),
      travelSeconds: num(entry, 'travel_time_seconds'), oneWay: bool(entry, 'one_way'),
    })),
    moves: array('moves').map((entry): CharacterMove => defined<CharacterMove>({
      character: text(entry, 'character') ?? '', to: text(entry, 'to') ?? '', position: text(entry, 'position'), feature: text(entry, 'feature'), ignoreExits: bool(entry, 'ignore_exits'),
    })),
    beliefs: array('beliefs').map((entry): NewBelief => defined<NewBelief>({
      character: text(entry, 'character') ?? '', kind: (text(entry, 'kind') ?? '') as MemoryKind, text: text(entry, 'text') ?? '', about: strings(entry, 'about'), importance: num(entry, 'importance') ?? 0,
    })),
    beliefEdits: array('belief_edits').map((entry): BeliefEdit => defined<BeliefEdit>({ id: num(entry, 'id') ?? 0, text: text(entry, 'text'), about: strings(entry, 'about'), importance: num(entry, 'importance') })),
    beliefRetractions: numbers('belief_retractions'),
    threadsOpened: Array.isArray(value['threads_opened']) ? (value['threads_opened'] as unknown[]).filter((entry): entry is string => typeof entry === 'string') : [],
    threadsResolved: numbers('threads_resolved'),
  }
  if (problems.length > 0) throw new InvalidEditError(problems)
  return edit
}

const IMPORTANCE: JsonSchemaNode = { type: 'integer', enum: [1, 2, 3, 4, 5], description: `From ${IMPORTANCE_MIN} (a passing detail) to ${IMPORTANCE_MAX} (turns the story).` }

/**
 * The JSON schema of the wire format, for a model's structured output or a tool's parameters.
 * With `characters`, a character can only be named by one of those keys.
 */
export function recordsEditSchema(options: { characters?: readonly string[]; changes?: boolean; /** Offer the making of characters, places and ways: only for the agent whose work that is. */ authoring?: boolean } = {}): ObjectJsonSchema {
  const character: JsonSchemaNode = options.characters === undefined || options.characters.length === 0
    ? { type: 'string', description: 'The key of a character.' }
    : { type: 'string', enum: [...options.characters], description: 'The key of a character.' }
  const keys: JsonSchemaNode = { type: 'array', items: character }
  const perceivedBy: JsonSchemaNode = {
    type: 'array',
    description: 'Who took the event in: only characters who could actually have perceived it. A character always perceives what it does or says itself.',
    items: {
      type: 'object',
      properties: {
        character,
        mode: { type: 'string', enum: [...PERCEPTION_MODES], description: 'How: saw it, heard it, was told, or worked it out.' },
        content: { type: 'string', description: 'What this character took in, in its own terms. Leave out when it took in exactly the event.' },
        gist: { type: 'string', description: 'The essence of it in a few words.' },
        accuracy: { type: 'string', enum: [...ACCURACIES], description: 'How well that matches what happened. Never shown to the character. Defaults to accurate.' },
      },
      required: ['character', 'mode'],
      additionalProperties: false,
    },
  }
  const placeKey: JsonSchemaNode = { type: 'string', description: 'The key of a place, as list_locations gives it, or one of the places made in this same edit.' }
  const featureList: JsonSchemaNode = {
    type: 'array',
    description: 'Named things in the place that a story can point at: a desk, a window, a notice board.',
    items: { type: 'object', properties: { key: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' } }, required: ['key', 'name'], additionalProperties: false },
  }
  const properties: ObjectJsonSchema['properties'] = {
    turn: { type: 'integer', description: 'The turn these records belong to.' },
    states: {
      type: 'array',
      description: 'The new state of the characters whose state changed. Give only the fields that changed.',
      items: {
        type: 'object',
        properties: {
          character,
          public_state: { type: 'string', description: 'What anyone present can now see of the character: a short present-tense description, never a log of events.' },
          inner_state: { type: 'string', description: 'What the character now thinks and feels; private.' },
          activity: { type: 'string', description: 'What the character is concretely doing now.' },
          emotion: {
            type: 'object',
            description: 'How the character feels right now, each axis from -1 to 1.',
            properties: { valence: { type: 'number' }, arousal: { type: 'number' }, dominance: { type: 'number' } },
            required: ['valence', 'arousal', 'dominance'],
            additionalProperties: false,
          },
        },
        required: ['character'],
        additionalProperties: false,
      },
    },
    events: {
      type: 'array',
      description: 'What objectively happened: short, factual, past-tense statements.',
      items: {
        type: 'object',
        properties: {
          turn: { type: 'integer' },
          round: { type: 'integer' },
          text: { type: 'string' },
          importance: IMPORTANCE,
          tags: { type: 'array', items: { type: 'string' }, description: 'Lowercase words a later search could use: objects, places, topics.' },
          involves: { ...keys, description: 'The characters the event is about: who acted and who it was done to.' },
          perceived_by: perceivedBy,
          location: { ...placeKey, description: 'Where it happened: the key of the place.' },
          items: { type: 'array', items: { type: 'string' }, description: 'The keys of the items it is about: what was taken, opened, handed over, found.' },
        },
        required: ['turn', 'round', 'text', 'importance', 'tags', 'involves', 'perceived_by'],
        additionalProperties: false,
      },
    },
    beliefs: {
      type: 'array',
      description: 'What a character has come to believe or know beyond a single event, from its own point of view.',
      items: {
        type: 'object',
        properties: {
          character,
          kind: { type: 'string', enum: [...MEMORY_KINDS] },
          text: { type: 'string' },
          about: keys,
          importance: IMPORTANCE,
        },
        required: ['character', 'kind', 'text', 'importance'],
        additionalProperties: false,
      },
    },
    relationships: {
      type: 'array',
      description: 'How a character stands towards another: a small profile, one per direction. Give only what changed; a new one needs a label. Record a change when something happened that really changes it, not for every pleasantry.',
      items: {
        type: 'object',
        properties: {
          from: character,
          to: character,
          label: { type: 'string', description: 'What the other is to this character, in a word or two: sister, rival, landlord.' },
          summary: { type: 'string', description: 'The relationship in a sentence or two: how it came about, what it is like now.' },
          familiarity: { type: 'number', description: 'How well it knows the other: 0 a stranger, 1 intimately.' },
          trust: { type: 'number', description: 'From -1 (distrusts) to 1 (trusts completely).' },
          affinity: { type: 'number', description: 'From -1 (dislikes) to 1 (is fond of).' },
          tension: { type: 'number', description: 'How strained it is now: 0 none, 1 about to break.' },
        },
        required: ['from', 'to'],
        additionalProperties: false,
      },
    },
    relationship_retractions: {
      type: 'array',
      description: 'Profiles that no longer describe anything: the two never actually met, or it was made by mistake.',
      items: { type: 'object', properties: { from: character, to: character }, required: ['from', 'to'], additionalProperties: false },
    },
    item_changes: {
      type: 'array',
      description: 'What characters do with items. Not for what the game master already decided; those are written already.',
      items: {
        type: 'object',
        properties: {
          character,
          item: { type: 'string', description: 'The key of the item, as list_items gives it.' },
          action: { type: 'string', enum: [...ITEM_ACTIONS] },
          to: { type: 'string', description: 'For give: the character; for put: the container item.' },
          slot: { type: 'string' },
          quantity: { type: 'integer' },
          position: { type: 'string' },
          feature: { type: 'string' },
          with: { type: 'string', description: 'For lock and unlock: the key item used.' },
          exit: { type: 'string', description: 'For lock and unlock of a way instead of an item: the key of the place it leads to.' },
          forced: { type: 'boolean' },
        },
        required: ['character', 'item', 'action'],
        additionalProperties: false,
      },
    },
    item_edits: {
      type: 'array',
      description: 'Changes to an item that no character did: its condition, a lock the story breaks, who it belongs to, what opens it. Give only what changes.',
      items: {
        type: 'object',
        properties: {
          item: { type: 'string' },
          description: { type: 'string' },
          quality: { type: 'string' },
          quantity: { type: 'integer' },
          notable: { type: 'boolean' },
          hidden: { type: 'boolean' },
          state: { type: 'string', enum: [...CONTAINER_STATES] },
          owner: character,
          opened_by: { type: 'array', items: { type: 'string' }, description: 'Replaces the items that open it.' },
        },
        required: ['item'],
        additionalProperties: false,
      },
    },
    place_edits: {
      type: 'array',
      description: 'Changes to a known place: it burned down, a feature appeared. Give only what changes; features replaces the list.',
      items: { type: 'object', properties: { place: placeKey, name: { type: 'string' }, description: { type: 'string' }, features: featureList }, required: ['place'], additionalProperties: false },
    },
    exit_changes: {
      type: 'array',
      description: 'The way between two places changed: a door unlocked, a passage collapsed. Applies to both directions unless one_way.',
      items: {
        type: 'object',
        properties: { from: placeKey, to: placeKey, state: { type: 'string', enum: [...EXIT_STATES] }, description: { type: 'string' }, note: { type: 'string' }, travel_time_seconds: { type: 'integer' }, one_way: { type: 'boolean' } },
        required: ['from', 'to'],
        additionalProperties: false,
      },
    },
    moves: {
      type: 'array',
      description: 'Where characters go. Not for what the game master already decided; those moves are written already.',
      items: {
        type: 'object',
        properties: { character, to: placeKey, position: { type: 'string' }, feature: { type: 'string' }, ignore_exits: { type: 'boolean' } },
        required: ['character', 'to'],
        additionalProperties: false,
      },
    },
    threads_opened: { type: 'array', items: { type: 'string' }, description: 'Promises made, mysteries raised, goals set that are not settled yet: one sentence each.' },
    threads_resolved: { type: 'array', items: { type: 'integer' }, description: 'The ids of open threads that are now settled.' },
  }
  if (options.authoring === true) {
    Object.assign(properties, {
      slots: {
        type: 'array',
        description: 'Places on the body something can be worn, when the world needs one it does not have (a tail, a quiver on the back). The usual ones exist.',
        items: { type: 'object', properties: { id: { type: 'string', description: 'Short and lowercase.' }, name: { type: 'string' }, capacity: { type: 'integer', description: 'How many things can be worn there at once.' } }, required: ['id', 'name', 'capacity'], additionalProperties: false },
      },
      items: {
        type: 'array',
        description: 'Things the story makes up, only when it genuinely needs them: an object handed over, found or drawn. Each starts in exactly one of at, held_by, worn_by or inside.',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'A short lowercase key that does not exist yet.' },
            name: { type: 'string' },
            description: { type: 'string' },
            quantity: { type: 'integer', description: 'How many, for things that come in numbers.' },
            unique: { type: 'boolean' },
            quality: { type: 'string', description: 'Its condition in words.' },
            notable: { type: 'boolean', description: 'Matters to the story.' },
            hidden: { type: 'boolean' },
            wearable: { type: 'string', description: 'The slot it is worn in.' },
            container: { type: 'object', properties: { state: { type: 'string', enum: [...CONTAINER_STATES] }, opened_by: { type: 'array', items: { type: 'string' } } }, additionalProperties: false },
            owner: character,
            at: { type: 'object', properties: { location: placeKey, position: { type: 'string' }, feature: { type: 'string' } }, required: ['location'], additionalProperties: false },
            held_by: character,
            worn_by: character,
            worn_position: { type: 'string' },
            inside: { type: 'string', description: 'The key of the container item it is in.' },
            inside_position: { type: 'string' },
            note: { type: 'string', description: 'Why it was made, for whoever fits it into the world later.' },
          },
          required: ['key', 'name'],
          additionalProperties: false,
        },
      },
      places: {
        type: 'array',
        description: 'Places the story makes up or opens: a hidden passage, a room that was behind a door. Only for places that are not already known.',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'A short lowercase key that does not exist yet.' },
            name: { type: 'string' },
            description: { type: 'string' },
            parent: placeKey,
            features: featureList,
            exits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  to: placeKey,
                  description: { type: 'string', description: 'What the way looks like from this place.' },
                  one_way: { type: 'boolean', description: 'Leave out for a way that works both ways.' },
                  back_description: { type: 'string' },
                  travel_time_seconds: { type: 'integer' },
                  state: { type: 'string', enum: [...EXIT_STATES] },
                  note: { type: 'string' },
                },
                required: ['to'],
                additionalProperties: false,
              },
            },
            note: { type: 'string', description: 'Why it was made, for whoever fits it into the world later.' },
          },
          required: ['key', 'name'],
          additionalProperties: false,
        },
      },
      exits: {
        type: 'array',
        description: 'New ways between places that exist (or are made in this edit). Both directions unless one_way.',
        items: {
          type: 'object',
          properties: { from: placeKey, to: placeKey, description: { type: 'string' }, one_way: { type: 'boolean' }, back_description: { type: 'string' }, travel_time_seconds: { type: 'integer' }, state: { type: 'string', enum: [...EXIT_STATES] }, note: { type: 'string' } },
          required: ['from', 'to'],
          additionalProperties: false,
        },
      },
      characters: {
        type: 'array',
        description: 'People the story makes up, only when it genuinely needs them. Played by an agent from what is given here.',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'A short lowercase key that does not exist yet.' },
            name: { type: 'string' },
            aliases: { type: 'array', items: { type: 'string' } },
            age: { type: 'string' },
            gender: { type: 'string' },
            pronouns: { type: 'string' },
            kind: { type: 'string', enum: [...CHARACTER_KINDS], description: 'person, or group for a crowd or organisation treated as one.' },
            tier: { type: 'string', enum: [...CHARACTER_TIERS], description: 'supporting by default; background for someone who only reacts.' },
            summary: { type: 'string', description: 'One or two sentences: who they are.' },
            personality: { type: 'string' },
            background: { type: 'string' },
            appearance: { type: 'string' },
            speech: { type: 'object', properties: { style: { type: 'string' }, examples: { type: 'array', items: { type: 'string' } } }, required: ['style'], additionalProperties: false },
            state: { type: 'object', properties: { public_state: { type: 'string' }, inner_state: { type: 'string' }, activity: { type: 'string' } }, additionalProperties: false },
            place: { type: 'object', properties: { location: placeKey, position: { type: 'string' }, feature: { type: 'string' } }, required: ['location'], additionalProperties: false },
            note: { type: 'string', description: 'Why they were made, for whoever fits them into the world later.' },
          },
          required: ['key', 'name', 'summary'],
          additionalProperties: false,
        },
      },
    })
  }
  if (options.changes === true) {
    Object.assign(properties, {
      event_edits: {
        type: 'array',
        description: 'Corrections to draft events of this run (a sealed event cannot change). Give only what changes; perceived_by replaces the whole list.',
        items: {
          type: 'object',
          properties: { id: { type: 'integer' }, text: { type: 'string' }, importance: IMPORTANCE, tags: { type: 'array', items: { type: 'string' } }, involves: keys, perceived_by: perceivedBy, location: placeKey },
          required: ['id'],
          additionalProperties: false,
        },
      },
      event_retractions: { type: 'array', items: { type: 'integer' }, description: 'Ids of recorded events that did not happen or duplicate another.' },
      perception_edits: {
        type: 'array',
        description: 'Revisions of what a character took in of an event (the ids are in read_records): it learned more, or remembers it differently. Allowed on any event.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            mode: { type: 'string', enum: [...PERCEPTION_MODES] },
            content: { type: 'string' },
            gist: { type: 'string' },
            accuracy: { type: 'string', enum: [...ACCURACIES] },
          },
          required: ['id'],
          additionalProperties: false,
        },
      },
      perceptions_added: {
        type: 'array',
        description: 'A character that took in an earlier event only now (it was told, or worked it out). Allowed on any event.',
        items: {
          type: 'object',
          properties: {
            event: { type: 'integer' },
            character,
            mode: { type: 'string', enum: [...PERCEPTION_MODES] },
            content: { type: 'string' },
            gist: { type: 'string' },
            accuracy: { type: 'string', enum: [...ACCURACIES] },
          },
          required: ['event', 'character', 'mode'],
          additionalProperties: false,
        },
      },
      belief_edits: {
        type: 'array',
        items: { type: 'object', properties: { id: { type: 'integer' }, text: { type: 'string' }, about: keys, importance: IMPORTANCE }, required: ['id'], additionalProperties: false },
      },
      belief_retractions: { type: 'array', items: { type: 'integer' } },
    })
  }
  return { type: 'object', properties, required: ['turn'], additionalProperties: false }
}

