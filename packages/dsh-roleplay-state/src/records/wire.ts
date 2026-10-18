import type { JsonSchemaNode, ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import {
  ACCURACIES, CHARACTER_KINDS, CHARACTER_TIERS, CONTAINER_STATES, ENGAGEMENT_STATUSES, EXIT_STATES, IMPORTANCE_MAX, IMPORTANCE_MIN, INTENT_HORIZONS, INTENT_STATUSES, INTENT_TYPES, KNOWLEDGE_KINDS, MEMORY_CONFIDENCES, MEMORY_KINDS, PERCEPTION_MODES, WEEKDAY_NAMES,
  VARIABLE_KINDS, VARIABLE_SUBJECTS, VARIABLE_VISIBILITIES,
  type VariableDefinitionInput, type VariableKind, type VariableSubject, type VariableValue, type VariableVisibility,
  type TriggerDefinition, type Accuracy, type CharacterKind, type CharacterTier, type ContainerState, type EngagementStatus, type ExitState, type IntentHorizon, type IntentStatus, type IntentType, type KnowledgeKind, type MemoryConfidence, type MemoryKind, type PerceptionMode, type Slot,
} from 'dsh-roleplay-model'
import { InvalidEditError } from '../errors.ts'
import type {
  BeliefEdit, CharacterMove, EngagementEditSpec, EventEdit, ExitChange, IntentEditSpec, ItemChange, NewEngagementSpec, NewIntentSpec, RoutineExceptionSpec, RoutineSet, RoutineWindowSpec, ItemEditSpec, NewBelief, NewCharacterSpec, NewEvent, NewExit, NewExitBetween, NewItemSpec, NewPlace,
  FactionMembershipSet, FactionRelationshipSet, FactionStateSet, KnowledgeRetraction, KnowledgeSet, NewFactionIntentSpec, PerceivedBy, PerceptionAddition, PerceptionEdit, PlaceEdit, RecordsEdit, RelationshipRetraction, RelationshipSet, StatePatch,
} from './edit-types.ts'
import { ITEM_ACTIONS, type ItemAction } from './items.ts'
import type { VariableChangeSpec } from './variables.ts'
import { parseTriggerDefinition } from './trigger-rules.ts'

/** An edit effect is an edit, but its events may be seen by `"everyone"`, which an ordinary edit cannot say. */
const checkEdit = (edit: Wire): void => {
  const events = Array.isArray(edit['events']) ? edit['events'].map(event => (isObject(event) && event['perceived_by'] === 'everyone' ? { ...event, perceived_by: [] } : event)) : edit['events']
  parseRecordsEdit({ ...edit, ...(events === undefined ? {} : { events }) })
}

/** Read a trigger as a world's files write it. @returns the definition, or every problem with where it is. */
export const readTriggerDefinition = (value: unknown, path: string): ReturnType<typeof parseTriggerDefinition> => parseTriggerDefinition(value, path, checkEdit)

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
  const numbersOf = (entry: Wire, key: string): number[] | undefined => {
    const found = entry[key]
    if (found === undefined || found === null) return undefined
    if (!Array.isArray(found) || found.some(item => typeof item !== 'number')) { problems.push(`${key} must be a list of numbers`); return undefined }
    return found as number[]
  }
  const text = (entry: Wire, key: string): string | undefined => (typeof entry[key] === 'string' ? entry[key] : undefined)
  /** A key, slot or position the model may leave blank instead of leaving out: blank is nothing given, not a name that does not exist. */
  const named = (entry: Wire, key: string): string | undefined => { const value = text(entry, key)?.trim(); return value === undefined || value === '' ? undefined : value }
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
  const scalar = (entry: Wire, key: string): VariableValue | undefined => { const found = entry[key]; return typeof found === 'number' || typeof found === 'string' || typeof found === 'boolean' ? found : undefined }
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
      quality: text(entry, 'quality'), notable: bool(entry, 'notable'), hidden: bool(entry, 'hidden'), wearable: named(entry, 'wearable'), owner: named(entry, 'owner'), note: text(entry, 'note'),
      container: isObject(entry['container']) ? defined<NonNullable<NewItemSpec['container']>>({ state: text(entry['container'], 'state') as ContainerState | undefined, openedBy: strings(entry['container'], 'opened_by') }) : undefined,
      at: isObject(entry['at']) && named(entry['at'], 'location') !== undefined ? defined<NonNullable<NewItemSpec['at']>>({ location: named(entry['at'], 'location') ?? '', position: named(entry['at'], 'position'), feature: named(entry['at'], 'feature') }) : undefined,
      heldBy: named(entry, 'held_by'), wornBy: named(entry, 'worn_by'), wornPosition: named(entry, 'worn_position'), inside: named(entry, 'inside'), insidePosition: named(entry, 'inside_position'),
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
    knowledge: array('knowledge').map((entry): KnowledgeSet => defined<KnowledgeSet>({ character: text(entry, 'character') ?? '', kind: (text(entry, 'kind') ?? '') as KnowledgeKind, subject: text(entry, 'subject'), from: text(entry, 'from'), to: text(entry, 'to'), observed: bool(entry, 'observed') })),
    knowledgeRetractions: array('knowledge_retractions').map((entry): KnowledgeRetraction => defined<KnowledgeRetraction>({ character: text(entry, 'character') ?? '', kind: (text(entry, 'kind') ?? '') as KnowledgeKind, subject: text(entry, 'subject'), from: text(entry, 'from'), to: text(entry, 'to') })),
    factionStates: array('faction_states').map((entry): FactionStateSet => defined<FactionStateSet>({ faction: text(entry, 'faction') ?? '', publicState: text(entry, 'public_state'), innerState: text(entry, 'inner_state') })),
    factionMemberships: array('faction_memberships').map((entry): FactionMembershipSet => defined<FactionMembershipSet>({ faction: text(entry, 'faction') ?? '', character: text(entry, 'character') ?? '', role: text(entry, 'role'), rank: text(entry, 'rank'), status: text(entry, 'status') as FactionMembershipSet['status'], public: bool(entry, 'public'), commitment: num(entry, 'commitment'), leftTurn: num(entry, 'left_turn') })),
    factionRelationships: array('faction_relationships').map((entry): FactionRelationshipSet => defined<FactionRelationshipSet>({ fromKind: (text(entry, 'from_kind') ?? '') as FactionRelationshipSet['fromKind'], from: text(entry, 'from') ?? '', toKind: (text(entry, 'to_kind') ?? '') as FactionRelationshipSet['toKind'], to: text(entry, 'to') ?? '', label: text(entry, 'label'), summary: text(entry, 'summary'), familiarity: num(entry, 'familiarity'), trust: num(entry, 'trust'), affinity: num(entry, 'affinity'), tension: num(entry, 'tension') })),
    factionIntentsAdded: array('faction_intents_added').map((entry): NewFactionIntentSpec => defined<NewFactionIntentSpec>({ faction: text(entry, 'faction') ?? '', type: (text(entry, 'type') ?? '') as IntentType, name: text(entry, 'name') ?? '', description: text(entry, 'description'), horizon: (text(entry, 'horizon') ?? '') as IntentHorizon, priority: num(entry, 'priority') ?? Number.NaN, urgency: num(entry, 'urgency') ?? Number.NaN, plan: strings(entry, 'plan'), constraints: strings(entry, 'constraints'), deadline: text(entry, 'deadline') })),
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
      confidence: text(entry, 'confidence') as MemoryConfidence | undefined, evidenceFor: numbersOf(entry, 'evidence_for'), evidenceAgainst: numbersOf(entry, 'evidence_against'),
    })),
    beliefEdits: array('belief_edits').map((entry): BeliefEdit => defined<BeliefEdit>({ id: num(entry, 'id') ?? 0, text: text(entry, 'text'), about: strings(entry, 'about'), importance: num(entry, 'importance'), confidence: text(entry, 'confidence') as MemoryConfidence | undefined, evidenceFor: numbersOf(entry, 'evidence_for'), evidenceAgainst: numbersOf(entry, 'evidence_against') })),
    beliefRetractions: numbers('belief_retractions'),
    threadsOpened: Array.isArray(value['threads_opened']) ? (value['threads_opened'] as unknown[]).filter((entry): entry is string => typeof entry === 'string') : [],
    threadsResolved: numbers('threads_resolved'),
    variableChanges: array('variable_changes').map((entry): VariableChangeSpec => defined<VariableChangeSpec>({
      variable: text(entry, 'variable') ?? '', subject: text(entry, 'subject') ?? '', to: scalar(entry, 'to'), by: num(entry, 'by'), baseline: scalar(entry, 'baseline'),
    })),
    variables: array('variables').map((entry): VariableDefinitionInput => defined<VariableDefinitionInput>({
      key: text(entry, 'key') ?? '', name: text(entry, 'name') ?? '', description: text(entry, 'description'), kind: (text(entry, 'kind') ?? '') as VariableKind, subject: (text(entry, 'subject') ?? '') as VariableSubject,
      only: strings(entry, 'only'), min: num(entry, 'min'), max: num(entry, 'max'), integer: bool(entry, 'integer'), options: strings(entry, 'options'), default: scalar(entry, 'default'),
      baseline: bool(entry, 'baseline'), visibility: text(entry, 'visibility') as VariableVisibility | undefined, always: bool(entry, 'always'),
      bands: Array.isArray(entry['bands']) ? entry['bands'].filter(isObject).map(band => ({ upTo: num(band, 'up_to') ?? Number.NaN, label: text(band, 'label') ?? '' })) : undefined,
    })),
    intentsAdded: array('intents_added').map((entry): NewIntentSpec => defined<NewIntentSpec>({
      character: text(entry, 'character') ?? '', type: (text(entry, 'type') ?? '') as IntentType, name: text(entry, 'name') ?? '', description: text(entry, 'description'),
      horizon: (text(entry, 'horizon') ?? '') as IntentHorizon, priority: num(entry, 'priority') ?? Number.NaN, urgency: num(entry, 'urgency') ?? Number.NaN,
      plan: strings(entry, 'plan'), constraints: strings(entry, 'constraints'), deadline: text(entry, 'deadline'),
    })),
    intentEdits: array('intent_edits').map((entry): IntentEditSpec => defined<IntentEditSpec>({
      id: num(entry, 'id') ?? 0, status: text(entry, 'status') as IntentStatus | undefined, description: text(entry, 'description'), horizon: text(entry, 'horizon') as IntentHorizon | undefined,
      priority: num(entry, 'priority'), urgency: num(entry, 'urgency'), plan: strings(entry, 'plan'), openThreads: strings(entry, 'open_threads'), deadline: text(entry, 'deadline'),
    })),
    engagements: array('engagements').map((entry): NewEngagementSpec => defined<NewEngagementSpec>({
      title: text(entry, 'title') ?? '', at: text(entry, 'at') ?? '', until: text(entry, 'until'), location: text(entry, 'location'), participants: strings(entry, 'participants') ?? [], note: text(entry, 'note'),
    })),
    engagementEdits: array('engagement_edits').map((entry): EngagementEditSpec => defined<EngagementEditSpec>({
      id: num(entry, 'id') ?? 0, status: text(entry, 'status') as EngagementStatus | undefined, title: text(entry, 'title'), at: text(entry, 'at'), until: text(entry, 'until'),
      location: text(entry, 'location'), participants: strings(entry, 'participants'), note: text(entry, 'note'),
    })),
    triggers: array('triggers').flatMap((entry, index): TriggerDefinition[] => {
      const parsed = parseTriggerDefinition(entry, `triggers[${index}]`, checkEdit)
      if ('problems' in parsed) { problems.push(...parsed.problems); return [] }
      return [parsed.definition]
    }),
    routineExceptions: array('routine_exceptions').map((entry): RoutineExceptionSpec => defined<RoutineExceptionSpec>({
      character: text(entry, 'character') ?? '', date: text(entry, 'date') ?? '', activity: text(entry, 'activity') ?? '', from: text(entry, 'from'), to: text(entry, 'to'),
      location: text(entry, 'location'), feature: text(entry, 'feature'), position: text(entry, 'position'), interruptible: bool(entry, 'interruptible'),
    })),
    routines: array('routines').map((entry): RoutineSet => ({
      character: text(entry, 'character') ?? '',
      windows: Array.isArray(entry['windows']) ? entry['windows'].filter(isObject).map((window): RoutineWindowSpec => defined<RoutineWindowSpec>({
        days: strings(window, 'days'), on: strings(window, 'on'), from: text(window, 'from') ?? '', to: text(window, 'to') ?? '', activity: text(window, 'activity') ?? '',
        location: text(window, 'location'), feature: text(window, 'feature'), position: text(window, 'position'), interruptible: bool(window, 'interruptible'),
      })) : [],
    })),
  }
  if (problems.length > 0) throw new InvalidEditError(problems)
  return edit
}

const scalarValue: JsonSchemaNode = { oneOf: [{ type: 'number' }, { type: 'boolean' }, { type: 'string' }], description: 'A number, true or false, or one of the words of a choice.' }

const CONFIDENCE: JsonSchemaNode = { type: 'string', enum: [...MEMORY_CONFIDENCES], description: 'How sure the character is: doubtful, likely (the default) or sure. Sure only for what it has seen more than once or cannot doubt.' }
const EVIDENCE_FOR: JsonSchemaNode = { type: 'array', items: { type: 'integer' }, description: 'The numbers of perceptions of the character (from read_records) that this rests on.' }
const EVIDENCE_AGAINST: JsonSchemaNode = { type: 'array', items: { type: 'integer' }, description: 'The numbers of perceptions of the character that speak against this; lower the confidence then.' }
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
          confidence: CONFIDENCE,
          evidence_for: EVIDENCE_FOR,
          evidence_against: EVIDENCE_AGAINST,
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
    knowledge: {
      type: 'array',
      description: 'Entities a character learns exist. For a location or item give subject; for a directed exit give from and to. This grants identity only, never current state or whereabouts.',
      items: {
        type: 'object',
        properties: { character, kind: { type: 'string', enum: [...KNOWLEDGE_KINDS] }, subject: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, observed: { type: 'boolean' } },
        required: ['character', 'kind'], additionalProperties: false,
      },
    },
    knowledge_retractions: {
      type: 'array',
      description: 'Entity awareness recorded by mistake. Ordinary stale information belongs in beliefs and does not remove awareness.',
      items: { type: 'object', properties: { character, kind: { type: 'string', enum: [...KNOWLEDGE_KINDS] }, subject: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } }, required: ['character', 'kind'], additionalProperties: false },
    },
    faction_states: {
      type: 'array', description: 'Changes in an organisation itself. Give only fields that changed.',
      items: { type: 'object', properties: { faction: { type: 'string' }, public_state: { type: 'string' }, inner_state: { type: 'string' } }, required: ['faction'], additionalProperties: false },
    },
    faction_memberships: {
      type: 'array', description: 'Membership learned or changed. A character may belong to several factions; public says whether outsiders can ordinarily know it.',
      items: { type: 'object', properties: { faction: { type: 'string' }, character, role: { type: 'string' }, rank: { type: 'string' }, status: { type: 'string', enum: ['active', 'inactive', 'former'] }, public: { type: 'boolean' }, commitment: { type: 'number' }, left_turn: { type: 'integer' } }, required: ['faction', 'character'], additionalProperties: false },
    },
    faction_relationships: {
      type: 'array', description: 'A directional profile involving a faction. This is also the awareness edge: without it, the from-side does not know the target exists.',
      items: { type: 'object', properties: { from_kind: { type: 'string', enum: ['character', 'faction'] }, from: { type: 'string' }, to_kind: { type: 'string', enum: ['character', 'faction'] }, to: { type: 'string' }, label: { type: 'string' }, summary: { type: 'string' }, familiarity: { type: 'number' }, trust: { type: 'number' }, affinity: { type: 'number' }, tension: { type: 'number' } }, required: ['from_kind', 'from', 'to_kind', 'to'], additionalProperties: false },
    },
    faction_intents_added: {
      type: 'array', description: 'A durable strategic goal newly adopted by a faction. This pressures its members but does not directly act for them.',
      items: { type: 'object', properties: { faction: { type: 'string' }, type: { type: 'string', enum: [...INTENT_TYPES] }, name: { type: 'string' }, description: { type: 'string' }, horizon: { type: 'string', enum: [...INTENT_HORIZONS] }, priority: { type: 'number' }, urgency: { type: 'number' }, plan: { type: 'array', items: { type: 'string' } }, constraints: { type: 'array', items: { type: 'string' } }, deadline: { type: 'string' } }, required: ['faction', 'type', 'name', 'horizon', 'priority', 'urgency'], additionalProperties: false },
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
    variable_changes: {
      type: 'array',
      description: 'What the story tracks changed: a feeling, a debt, a reputation, a flag (list_variables shows what is tracked and what each is about). Give exactly one of to (the new value), by (an amount a number goes up or down; it stops at its bounds) or baseline (the new temperament of a variable that has one). Only what the rounds clearly establish.',
      items: {
        type: 'object',
        properties: {
          variable: { type: 'string', description: 'The key of the variable.' },
          subject: { type: 'string', description: 'The key of the character, item or place it is about; world for a variable of the whole story.' },
          to: scalarValue,
          by: { type: 'number' },
          baseline: scalarValue,
        },
        required: ['variable', 'subject'],
        additionalProperties: false,
      },
    },
    intents_added: {
      type: 'array',
      description: 'A goal the story gave a character: a promise it made, a task it took on, a scheme it set in motion. Only what the rounds clearly establish; never one that is already listed for it.',
      items: {
        type: 'object',
        properties: {
          character,
          type: { type: 'string', enum: [...INTENT_TYPES] },
          name: { type: 'string', description: 'A few words.' },
          description: { type: 'string' },
          horizon: { type: 'string', enum: [...INTENT_HORIZONS] },
          priority: { type: 'number', description: 'How much it matters to the character, 0 to 1.' },
          urgency: { type: 'number', description: 'How soon it has to be dealt with, 0 to 1.' },
          plan: { type: 'array', items: { type: 'string' }, description: 'The next steps, a sentence each.' },
          constraints: { type: 'array', items: { type: 'string' } },
          deadline: { type: 'string', description: 'When it has to be done by: a date and time, 1912-09-22T18:00, in the time zone of the story.' },
        },
        required: ['character', 'type', 'name', 'horizon', 'priority', 'urgency'],
        additionalProperties: false,
      },
    },
    intent_edits: {
      type: 'array',
      description: 'A goal of a character that moved on (the ids are in read_records): done, failed, given up, more or less pressing, a step taken. Give only what changes; plan replaces the steps.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          status: { type: 'string', enum: [...INTENT_STATUSES] },
          description: { type: 'string' },
          horizon: { type: 'string', enum: [...INTENT_HORIZONS] },
          priority: { type: 'number' },
          urgency: { type: 'number' },
          plan: { type: 'array', items: { type: 'string' } },
          open_threads: { type: 'array', items: { type: 'string' } },
          deadline: { type: 'string' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
    engagements: {
      type: 'array',
      description: 'Something characters committed to at a time: a meeting arranged, an errand promised, an event they are to attend. Only when the rounds clearly establish a time (or a time of day that can be worked out from the story\'s clock).',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'A few words: "Meet Clara at the bar".' },
          at: { type: 'string', description: 'When it is due: a date and time, 1912-09-22T21:00, in the time zone of the story.' },
          until: { type: 'string', description: 'When it is over, when that matters.' },
          location: placeKey,
          participants: { ...keys, description: 'Who has committed to it: each character that is to be there.' },
          note: { type: 'string' },
        },
        required: ['title', 'at', 'participants'],
        additionalProperties: false,
      },
    },
    routine_exceptions: {
      type: 'array',
      description: 'A day on which a character does something other than its routine says (ill in bed, away on an errand, a day off): the date (YYYY-MM-DD, story-local), what it does and where; it takes the place of the routine on that date only. Setting the same date again replaces it.',
      items: {
        type: 'object',
        properties: {
          character,
          date: { type: 'string', description: 'YYYY-MM-DD.' },
          activity: { type: 'string', description: 'What it does that day: "keeps to bed with a fever".' },
          from: { type: 'string', description: 'HH:MM; leave out with to for the whole day.' },
          to: { type: 'string', description: 'HH:MM.' },
          location: placeKey,
          feature: { type: 'string' },
          position: { type: 'string' },
          interruptible: { type: 'boolean' },
        },
        required: ['character', 'date', 'activity'],
        additionalProperties: false,
      },
    },
    engagement_edits: {
      type: 'array',
      description: 'An engagement that moved on (the ids are in read_records): it was kept, missed, cancelled, or put off. Give only what changes.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          status: { type: 'string', enum: [...ENGAGEMENT_STATUSES] },
          title: { type: 'string' },
          at: { type: 'string' },
          until: { type: 'string' },
          location: placeKey,
          participants: keys,
          note: { type: 'string' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
    threads_opened: { type: 'array', items: { type: 'string' }, description: 'Promises made, mysteries raised, goals set that are not settled yet: one sentence each.' },
    threads_resolved: { type: 'array', items: { type: 'integer' }, description: 'The ids of open threads that are now settled.' },
  }
  if (options.authoring === true) {
    Object.assign(properties, {
      variables: {
        type: 'array',
        description: 'A thing the story now tracks, declared only when what it established matters from here on and nothing tracked fits (a debt, a character\'s health, a reputation, whether a door is known). Declared once; then changed with variable_changes (in the same call too).',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Lowercase letters, digits and underscores, starting with a letter.' },
            name: { type: 'string' },
            description: { type: 'string', description: 'What it measures or means, for those who read and change it.' },
            kind: { type: 'string', enum: [...VARIABLE_KINDS] },
            subject: { type: 'string', enum: [...VARIABLE_SUBJECTS], description: 'What each value is about: every character, item or place has its own; world has one for the whole story.' },
            only: { type: 'array', items: { type: 'string' }, description: 'Keys of the subjects it applies to; leave out for all of its kind.' },
            min: { type: 'number' },
            max: { type: 'number' },
            integer: { type: 'boolean' },
            options: { type: 'array', items: { type: 'string' }, description: 'For a choice: from 2 to 12 words.' },
            default: scalarValue,
            baseline: { type: 'boolean', description: 'Whether each value has a temperament beside the current value (feelings do).' },
            visibility: { type: 'string', enum: [...VARIABLE_VISIBILITIES], description: 'public: anyone present can tell; private: only the character it belongs to (and the game master); hidden: only the game master.' },
            bands: { type: 'array', items: { type: 'object', properties: { up_to: { type: 'number' }, label: { type: 'string' } }, required: ['up_to', 'label'], additionalProperties: false }, description: 'Words for ranges of a number, lowest first: values up to up_to are called label.' },
            always: { type: 'boolean', description: 'Tell it always, not only once it differs from its default.' },
          },
          required: ['key', 'name', 'kind', 'subject'],
          additionalProperties: false,
        },
      },
      triggers: {
        type: 'array',
        description: 'Things the world does by itself when something comes true, made only when the story has set up a moment that is bound to come (a deadline, a promised arrival, a trap, a storm) and nothing existing covers it. At most two at a time. Each fires once, when its condition turns true.',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Lowercase letters, digits, hyphens and underscores.' },
            name: { type: 'string', description: 'A short label for the author; never shown to any character.' },
            when: {
              type: 'object',
              description: 'The condition, decided in code from what the story has recorded. One of: {type:"time", from:"1912-10-05T21:00", to?, window?:{from:"22:00",to:"06:00"}, days?:["fri"]} (story-local times); {type:"place", character, location, feature?}; {type:"variable", variable, subject? (the key of the character, item or place; none for a world variable), op: eq|ne|lt|le|gt|ge, value}; {type:"item", item, held_by? | at?}; {type:"event", tag}; {type:"fired", trigger}; and {type:"all"|"any", conditions:[...]} or {type:"not", condition}, nested at most 4 deep.',
              properties: { type: { type: 'string', enum: ['time', 'place', 'variable', 'item', 'event', 'fired', 'all', 'any', 'not'] } },
              required: ['type'],
              additionalProperties: true,
            },
            effects: {
              type: 'array',
              description: 'What happens, one to six: {type:"edit", edit:{...}} a change of the records in the same format as edit_records (events with a location are seen by those there, variable_changes, exit_changes, item_changes, moves, intents_added, engagements); {type:"beat", text, while?} something the game master is told to weave into the story; {type:"cue", characters:[keys] (or audience: "everyone" | {place:key}), text, while?} something those characters notice; a beat or cue is written when it is told, which may be turns after the trigger fired: its text may name things as {character:key}, {place:key}, {item:key}, {where:character} (the place a character is in), {holder:item} (who has it or where it lies), {value:variable} or {value:variable:subject}, {time}, and is told as the story stands then, and `while` is a condition (as above, nothing judged) that must still hold then or it is withdrawn; in a cue \"@self\" stands for the character it is said to (for example while:{type:\"place\", character:\"@self\", location:\"cellar\"}); in the events of an edit, perceived_by may be "everyone".',
              items: { type: 'object', properties: { type: { type: 'string', enum: ['edit', 'beat', 'cue'] } }, required: ['type'], additionalProperties: true },
            },
            repeat: { type: 'boolean', description: 'Fire again after the condition went false and true again. Default no.' },
            cooldown_seconds: { type: 'integer', description: 'With repeat: the least story time between two firings.' },
            chance: { type: 'number', description: 'From 0 to 1: the chance that it fires when the condition turns true.' },
            priority: { type: 'integer', description: 'The higher goes first when several are due at once.' },
            expires: { type: 'string', description: 'After this story-local time it never fires.' },
            announce: {
              type: 'object',
              description: 'Only for something that is no secret, scheduled and known beforehand (an exam, a ball, a deadline): who knows of it and what they know. Without it nobody knows until it fires. audience is "everyone", {characters:[keys]} or {place:key} (whoever is there); text is the public side only, never what the effects do; from is when it becomes known (story-local time; known at once when left out); at is when it happens, when the condition does not say so by a plain time.',
              properties: { audience: { type: 'object', description: '"everyone", or {characters:[keys]}, or {place:key}.', additionalProperties: true }, text: { type: 'string' }, from: { type: 'string' }, at: { type: 'string' } },
              required: ['audience', 'text'],
              additionalProperties: false,
            },
          },
          required: ['key', 'name', 'when', 'effects'],
          additionalProperties: false,
        },
      },
      routines: {
        type: 'array',
        description: 'The recurring day of a character who matters off stage and has none: windows of the day with what it is doing and where, in the order they apply (the first that fits applies). Replaces what it had.',
        items: {
          type: 'object',
          properties: {
            character,
            windows: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  days: { type: 'array', items: { type: 'string', enum: [...WEEKDAY_NAMES] }, description: 'Leave out for every day.' },
                  on: { type: 'array', items: { type: 'string' }, description: 'Other days it applies on, as well as days: months (dec), dates (12-24, 1912-09-21), stretches (12-20..01-05), dom:1, nth:mon:1 (first Monday), season:winter, holiday:<id>; a ! before one is a day it does not apply on (!holiday:festival). Leave out for every day.' },
                  from: { type: 'string', description: 'HH:MM, 24-hour.' },
                  to: { type: 'string', description: 'HH:MM; a time before from ends the next day (22:00 to 06:00).' },
                  activity: { type: 'string', description: 'What it is doing: "minds the shop", "sleeps".' },
                  location: placeKey,
                  feature: { type: 'string' },
                  position: { type: 'string' },
                  interruptible: { type: 'boolean', description: 'Whether it would drop this for something that comes up; true by default.' },
                },
                required: ['from', 'to', 'activity'],
                additionalProperties: false,
              },
            },
          },
          required: ['character', 'windows'],
          additionalProperties: false,
        },
      },
      slots: {
        type: 'array',
        description: 'Places on the body something can be worn, when the world needs one it does not have (a tail, a quiver on the back). The usual ones exist.',
        items: { type: 'object', properties: { id: { type: 'string', description: 'Short and lowercase.' }, name: { type: 'string' }, capacity: { type: 'integer', description: 'How many things can be worn there at once.' } }, required: ['id', 'name', 'capacity'], additionalProperties: false },
      },
      items: {
        type: 'array',
        description: 'Things the story makes up, only when it genuinely needs them: an object handed over, found or drawn. Each starts in exactly one of at (lying in a place), held_by (carried by a character), worn_by (worn by a character) or inside (in a container item). Leave out every field you have nothing to say about; never send an empty string.',
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
            at: { type: 'object', description: 'It lies in this place: {"location": the place\'s key, "feature": a feature of the place such as its counter, "position": in words}.', properties: { location: placeKey, position: { type: 'string' }, feature: { type: 'string' } }, required: ['location'], additionalProperties: false },
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
        items: { type: 'object', properties: { id: { type: 'integer' }, text: { type: 'string' }, about: keys, importance: IMPORTANCE, confidence: CONFIDENCE, evidence_for: EVIDENCE_FOR, evidence_against: EVIDENCE_AGAINST }, required: ['id'], additionalProperties: false },
      },
      belief_retractions: { type: 'array', items: { type: 'integer' } },
    })
  }
  return { type: 'object', properties, required: ['turn'], additionalProperties: false }
}
