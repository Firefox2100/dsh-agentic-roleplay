import { promptFor } from '../prompts/access.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ObjectJsonSchema, ToolDefinition } from '@deepseek-ai/dsh-tools'
import { characterKey, createTools, describeHolder, itemKey, lintWorld, locationKey, parseRecordsEdit, type LintFinding } from '@dsh-agentic-roleplay/state'
import { zoneOf } from '../clock/story-clock.ts'
import { estimateAnswer } from '../agents/budget.ts'
import { childModel, childSampling, childTrace, runChild } from '../agents/child.ts'
import type { Author, ConsolidateJob, ConsolidateReport, CreateJob, CreateReport, TurnStore } from '../orchestration/boundaries.ts'

/** How many calls of the tools of other plugins the author may make on top of its own budget. */
const EXTERNAL_CALLS = 10



/** The tools of the world author, and what each does to the work. */
interface Work {
  created: { kind: 'character' | 'place' | 'item' | 'variable' | 'trigger'; key: string }[]
}

/** A made-up thing in one edit: its name, description and the handful of fields a character, place or item carries. */
const THING_TEXTS = 14
const THING_TEXT_CHARS = 300
/** What consolidating one waiting item writes: a way or a relationship with its descriptions. */
const FIT_TEXTS = 6
const FIT_TEXT_CHARS = 200

const editEstimate = (things: number, texts: number, chars: number, language: string): number => estimateAnswer(Array.from({ length: Math.max(1, things) * texts }, () => chars), language)

/** The keys of the people, places and things an edit makes that this run made already: made once, they are connected, not made again. */
export function madeAgain(args: Record<string, unknown>, work: { created: readonly { key: string }[] }): string[] {
  const made = new Set(work.created.map(entry => entry.key))
  const keys = ['characters', 'places', 'items'].flatMap(field => (Array.isArray(args[field]) ? args[field] as unknown[] : []).flatMap(entry => (typeof entry === 'object' && entry !== null && typeof (entry as { key?: unknown }).key === 'string' ? [(entry as { key: string }).key] : [])))
  return [...new Set(keys.filter(key => made.has(key)))]
}

/** A person made up without a place joins the scene: the place of the player's character, which is where the author is told to put them. */
export function placedWhereThePlayerIs(args: Record<string, unknown>, store: Pick<TurnStore, 'cast'>): Record<string, unknown> {
  if (!Array.isArray(args['characters'])) return args
  const here = store.cast().find(member => member.character.control === 'player')?.place?.location
  if (here === undefined) return args
  const characters = args['characters'].map(entry => (typeof entry === 'object' && entry !== null && (entry as Record<string, unknown>)['place'] === undefined ? { ...entry, place: { location: locationKey(here) } } : entry))
  return { ...args, characters }
}

function authorTools(job: { chat: string; store: TurnStore; turn: number }, work: Work, mode: 'create' | 'consolidate', limits: { perTurn: number }): ToolDefinition[] {
  const link = { session: job.store.story, turn: job.turn, policy: job.store.settings().memory, queryVector: job.store.queryVector, timeZone: zoneOf(job.store.settings().clock) }
  const keys = job.store.story.characters.list().map(characterKey)
  const wanted = new Set(['list_characters', 'get_character', 'list_factions', 'get_faction', 'list_relationships', 'list_items', 'get_item', 'list_slots', 'list_variables', 'list_locations', 'get_location', 'get_agenda', 'search_events', 'world_lint', 'edit_world', ...(mode === 'consolidate' ? ['list_consolidation', 'resolve_consolidation'] : [])])
  return createTools(() => link, { write: true, authoring: true, characters: keys })
    .filter(tool => wanted.has(tool.name))
    .map((tool): ToolDefinition => {
      if (tool.name !== 'edit_world') return tool
      return {
        ...tool,
        execute: async (args, exec) => {
          const edit = parseRecordsEdit(args)
          const makes = (edit.characters?.length ?? 0) + (edit.places?.length ?? 0) + (edit.items?.length ?? 0) + (edit.variables?.length ?? 0) + (edit.triggers?.length ?? 0)
          if (mode === 'consolidate' && makes > 0) throw new Error('fitting things in does not make up anything new: connect what exists')
          const madeBefore = job.store.story.consolidation.createdIn(job.turn)
          const allowed: [string, number, number][] = [
            ['character', edit.characters?.length ?? 0, madeBefore.filter(entry => entry.kind === 'character').length],
            ['place', edit.places?.length ?? 0, madeBefore.filter(entry => entry.kind === 'location').length],
            ['other thing', (edit.items?.length ?? 0) + (edit.variables?.length ?? 0) + (edit.triggers?.length ?? 0), 0],
          ]
          for (const [noun, now, already] of allowed) {
            if (now > 0 && already + now > limits.perTurn) {
              throw new Error(`this edit makes ${now} new ${noun}${now === 1 ? '' : 's'} and ${already} ${already === 1 ? 'was' : 'were'} already made this turn, which would pass the ${limits.perTurn} this chat allows per turn for each kind: make fewer, or none`)
            }
          }
          const again = madeAgain(args as Record<string, unknown>, work)
          if (again.length > 0) throw new Error(`${again.join(', ')} ${again.length === 1 ? 'is' : 'are'} already made in this run: do not make ${again.length === 1 ? 'it' : 'them'} again. A later edit_world call leaves ${again.length === 1 ? 'it' : 'them'} out and only adds what is still missing (relationships, ways, moves); when nothing is missing, call submit_result with outcome created.`)
          const result = await tool.execute(placedWhereThePlayerIs(args as Record<string, unknown>, job.store), exec) as { character_keys?: string[]; place_keys?: string[]; item_keys?: string[]; variable_keys?: string[]; trigger_keys?: string[] }
          for (const key of result.character_keys ?? []) work.created.push({ kind: 'character', key })
          for (const key of result.place_keys ?? []) work.created.push({ kind: 'place', key })
          for (const key of result.item_keys ?? []) work.created.push({ kind: 'item', key })
          for (const key of result.variable_keys ?? []) work.created.push({ kind: 'variable', key })
          for (const key of result.trigger_keys ?? []) work.created.push({ kind: 'trigger', key })
          return result as never
        },
      }
    })
}

const names = (store: TurnStore): { characters: Map<string, string>; places: Map<string, string>; items: Map<string, string> } => ({
  characters: new Map(store.story.characters.list().map(character => [characterKey(character), character.name])),
  places: new Map(store.story.locations.list().map(place => [locationKey(place), place.name])),
  items: new Map(store.story.items.list().map(item => [itemKey(item), item.name])),
})

const MAX_LISTED = 80

/** The characters and places that exist, so that a request for a duplicate is seen as one. */
function describeWorld(store: TurnStore): string[] {
  const { characters, places } = { characters: store.story.characters.list(), places: store.story.locations.list() }
  const where = (id: number): string => { const placement = store.story.placements.get('character', id); const place = placement === undefined ? undefined : store.story.locations.get(placement.locationId); return place === undefined ? '' : ` in ${place.name}` }
  const placeKey = (id: number | undefined): string => { const parent = id === undefined ? undefined : store.story.locations.get(id); return parent === undefined ? '' : ` inside ${parent.name}` }
  return [
    '## Characters that exist',
    ...characters.slice(0, MAX_LISTED).map(character => `- ${characterKey(character)}: ${character.name}${character.aliases.length === 0 ? '' : ` (also ${character.aliases.join(', ')})`}${where(character.id)}${character.control === 'player' ? ' [the player]' : ''} - ${character.summary || 'no summary'}`),
    ...(characters.length > MAX_LISTED ? [`- and ${characters.length - MAX_LISTED} more (list_characters shows them)`] : []),
    '',
    '## Places that exist',
    ...places.slice(0, MAX_LISTED).map(place => `- ${locationKey(place)}: ${place.name}${placeKey(place.parentId)}`),
    ...(places.length > MAX_LISTED ? [`- and ${places.length - MAX_LISTED} more (list_locations shows them)`] : []),
    '',
    '## Things that matter (notable first)',
    ...store.story.items.list().sort((a, b) => Number(b.notable) - Number(a.notable) || a.id - b.id).slice(0, MAX_LISTED).map(item => `- ${itemKey(item)}: ${item.name}${item.quantity > 1 ? ` x${item.quantity}` : ''}${item.notable ? ' [notable]' : ''}`),
    ...(store.story.items.list().length > MAX_LISTED ? [`- and ${store.story.items.list().length - MAX_LISTED} more (list_items shows them)`] : []),
    '',
    `## Slots (where things are worn): ${store.story.slots.list().map(slot => `${slot.id} (${slot.capacity})`).join(', ')}`,
  ]
}

function describeFindings(findings: readonly LintFinding[], limit = 30): string[] {
  if (findings.length === 0) return ['- nothing']
  return [...findings.slice(0, limit).map(finding => `- ${finding.severity} ${finding.code} (${finding.subject.kind} ${finding.subject.key}): ${finding.message}`), ...(findings.length > limit ? [`- and ${findings.length - limit} more`] : [])]
}

export function createPrompt(job: CreateJob, perTurn: number): string {
  const { store } = job
  const player = store.cast().find(member => member.character.control === 'player')
  const here = player?.place?.location
  const present = here === undefined ? [] : store.cast().filter(member => member.place?.location.id === here.id)
  const recent = store.story.events.list().slice(-6)
  return [
    `The game master asks for something to be made up. Reason given: ${job.need}.`,
    `What it says is needed: ${job.what}`,
    '',
    `It is turn ${job.turn}. At most ${perTurn} new character${perTurn === 1 ? '' : 's'} and ${perTurn} new place${perTurn === 1 ? '' : 's'} may be made in a turn (each kind has its own allowance); already made this turn: ${store.story.consolidation.createdIn(job.turn).filter(entry => entry.kind === 'character').length} character(s), ${store.story.consolidation.createdIn(job.turn).filter(entry => entry.kind === 'location').length} place(s).`,
    here === undefined ? 'The story is not in any place yet.' : `The story is in ${here.name} (${locationKey(here)}). With the player's character: ${present.filter(member => member.character.control !== 'player').map(member => `${member.character.name} (${member.key})`).join(', ') || 'no one else'}.`,
    '',
    '## What happened lately',
    ...(recent.length === 0 ? ['- nothing recorded yet'] : recent.map(event => `- [turn ${event.turn}] ${event.text}`)),
    '',
    ...describeWorld(store),
  ].join('\n')
}

const CREATE_RESULT: ObjectJsonSchema = {
  type: 'object',
  properties: {
    outcome: { type: 'string', enum: ['created', 'declined'], description: 'created if you made what the story needs, declined if it does not meet the bar or something that exists can serve.' },
    summary: { type: 'string', description: 'What you made and how you connected it, or why you declined and what exists that can serve.' },
  },
  required: ['outcome', 'summary'],
  additionalProperties: false,
}

/** What a created thing still lacks to be usable: the lint errors about exactly what was made. */
function errorsAbout(store: TurnStore, work: Work): LintFinding[] {
  const made = new Set(work.created.map(entry => `${entry.kind === 'character' ? 'character' : entry.kind === 'item' ? 'item' : 'location'}:${entry.key}`))
  return lintWorld(store.story).filter(finding => finding.severity === 'error' && made.has(`${finding.subject.kind}:${finding.subject.key}`))
}

function consolidationPrompt(job: ConsolidateJob): string {
  const { store } = job
  const story = store.story
  const pending = story.consolidation.pending()
  const label = names(store)
  const around = pending.map((item) => {
    if (item.kind === 'character') {
      const character = story.characters.get(item.subjectId)
      if (character === undefined) return `- item ${item.id}: a character that no longer exists`
      const key = characterKey(character)
      const placement = story.placements.get('character', character.id)
      const place = placement === undefined ? undefined : story.locations.get(placement.locationId)
      const company = place === undefined ? [] : story.placements.at(place.id, 'character').flatMap(entry => (entry.entityId === character.id ? [] : [story.characters.get(entry.entityId)?.name ?? '']))
      const events = story.events.perceivedBy(character.id).slice(-4).map(entry => `[turn ${entry.event.turn}] ${entry.event.text}`)
      const mine = story.relationships.from(character.id).map(relation => `${label.characters.get(characterKey(story.characters.get(relation.toId)!)) ?? relation.toId}: ${relation.label}`)
      return [`- item ${item.id}, character ${key} (${character.name}), made in turn ${item.createdTurn}: ${item.note}`, `    summary: ${character.summary}`, `    in: ${place?.name ?? 'no place'}${company.length === 0 ? '' : `, with ${company.join(', ')}`}`, `    already sees: ${mine.join('; ') || 'no one'}`, `    what it took in: ${events.join(' | ') || 'nothing yet'}`].join('\n')
    }
    if (item.kind === 'item') {
      const thing = story.items.get(item.subjectId)
      if (thing === undefined) return `- item ${item.id}: a thing that no longer exists`
      const owner = thing.ownerId === undefined ? undefined : story.characters.get(thing.ownerId)
      return [`- item ${item.id}, thing ${itemKey(thing)} (${thing.name}), made in turn ${item.createdTurn}: ${item.note}`, `    ${thing.description || 'no description'}`, `    where: ${describeHolder({ items: story.items, locations: story.locations, characters: story.characters }, thing.id, id => story.characters.get(id)?.name ?? String(id))}; owner: ${owner?.name ?? 'nobody'}${thing.container === undefined ? '' : `; ${thing.container.state}, opened by: ${story.items.openers({ kind: 'item', id: thing.id }).map(id => story.items.get(id)?.name ?? id).join(', ') || 'nothing known'}`}`].join('\n')
    }
    const place = story.locations.get(item.subjectId)
    if (place === undefined) return `- item ${item.id}: a place that no longer exists`
    const exits = story.locations.exitsFrom(place.id).map(exit => `${label.places.get(locationKey(story.locations.get(exit.toId)!)) ?? exit.toId} (${exit.state})`)
    const parent = place.parentId === undefined ? undefined : story.locations.get(place.parentId)
    return [`- item ${item.id}, place ${locationKey(place)} (${place.name}), made in turn ${item.createdTurn}: ${item.note}`, `    ${place.description || 'no description'}`, `    inside: ${parent?.name ?? 'nothing'}; ways out: ${exits.join('; ') || 'none'}`].join('\n')
  })
  return [
    `It is turn ${job.turn}. These were made up in play and are waiting to be fitted into the world:`,
    ...around,
    '',
    '## What is inconsistent or unfinished now',
    ...describeFindings(lintWorld(story)),
    '',
    ...describeWorld(store),
  ].join('\n')
}

const CONSOLIDATE_RESULT: ObjectJsonSchema = {
  type: 'object',
  properties: {
    complete: { type: 'boolean', description: 'True when everything waiting is fitted in and the world shows no errors. False only when something could not be fitted in from what is known.' },
    notes: { type: 'string', description: 'What you did, or what could not be done and why.' },
  },
  required: ['complete', 'notes'],
  additionalProperties: false,
}

/**
 * The world author: a child agent of the game master with the tools to read the world and to make up and
 * connect characters and places, which no other agent has. It is asked in two ways. To create, it decides
 * whether the story genuinely needs something and makes it (or declines, saying what can serve), and may
 * not finish before what it made is usable. To consolidate, it fits what was made up in play into the rest
 * of the world (ways between places, relationship profiles between characters) and may not finish before
 * everything waiting is resolved and the world shows no errors.
 */
export function worldAuthor(deps: { agentOf: (chat: string) => Agent | undefined; /** The tools of other plugins the person gave this author. */ external?: (parent: Agent) => readonly string[] }): Author {
  const parentOf = (chat: string): Agent => {
    const parent = deps.agentOf(chat)
    if (parent === undefined) throw new Error(`no agent for chat ${chat}`)
    return parent
  }
  const given = (parent: Agent): readonly string[] => deps.external?.(parent) ?? []
  return {
    async create(job, signal): Promise<CreateReport> {
      const parent = parentOf(job.chat)
      const { authoring } = job.store.settings()
      const work: Work = { created: [] }
      // what the author made stays in the world whether or not it managed to report: a run that fails after creating is told as created, so that what it made is fitted in
      const result = await runChild<{ outcome: 'created' | 'declined'; summary: string }>({
        reasoningEffort: job.store.settings().reasoning.children, sampling: childSampling(job.store.settings(), 'authoring', editEstimate(authoring.perTurn, THING_TEXTS, THING_TEXT_CHARS, job.store.settings().prompts.language)), ...childModel(job.store.settings(), 'authoring'), trace: childTrace(job.store, 'authoring', 'world author'),
        parent, signal,
        persona: promptFor(parent, 'world/author', job.store.settings().prompts.language),
        prompt: createPrompt(job, authoring.perTurn),
        tools: authorTools(job, work, 'create', authoring),
        external: given(parent),
        result: CREATE_RESULT,
        beforeSubmit: (value) => {
          const { outcome } = value as { outcome: 'created' | 'declined' }
          if (outcome === 'declined' && work.created.length > 0) return 'you already made something: say created, or the world is left half made'
          if (outcome === 'created' && work.created.length === 0) return 'you have made nothing: make it with edit_world, or decline and say why'
          const errors = errorsAbout(job.store, work)
          return errors.length === 0 ? undefined : `what you made is not usable yet; fix it with edit_world:\n${describeFindings(errors).join('\n')}`
        },
        maxCalls: 30 + (given(parent).length > 0 ? EXTERNAL_CALLS : 0),
      }).catch((error: unknown): { outcome: 'created'; summary: string } => {
        if (work.created.length === 0 || signal.aborted) throw error
        return { outcome: 'created', summary: `the author made it but did not finish its report (${error instanceof Error ? error.message : String(error)})` }
      })
      const label = names(job.store)
      const created = work.created.map(entry => ({ kind: entry.kind, key: entry.key, name: (entry.kind === 'variable' ? job.store.story.variables.def(entry.key)?.name : entry.kind === 'trigger' ? job.store.story.triggers.getByKey(entry.key)?.name : (entry.kind === 'character' ? label.characters : entry.kind === 'item' ? label.items : label.places).get(entry.key)) ?? entry.key }))
      return created.length > 0 ? { created, ...(result.outcome === 'declined' ? { declined: result.summary } : {}) } : { created: [], declined: result.summary }
    },

    async consolidate(job, signal): Promise<ConsolidateReport> {
      const pending = job.store.story.consolidation.pending()
      if (pending.length === 0) return { resolved: 0, notes: '' }
      const parent = parentOf(job.chat)
      const { authoring } = job.store.settings()
      const work: Work = { created: [] }
      const result = await runChild<{ complete: boolean; notes: string }>({
        reasoningEffort: job.store.settings().reasoning.children, sampling: childSampling(job.store.settings(), 'authoring', editEstimate(pending.length, FIT_TEXTS, FIT_TEXT_CHARS, job.store.settings().prompts.language)), ...childModel(job.store.settings(), 'authoring'), trace: childTrace(job.store, 'authoring', 'world consolidation'),
        parent, signal,
        persona: promptFor(parent, 'world/consolidate', job.store.settings().prompts.language),
        prompt: consolidationPrompt(job),
        tools: authorTools(job, work, 'consolidate', authoring),
        external: given(parent),
        result: CONSOLIDATE_RESULT,
        beforeSubmit: (value) => {
          if (!(value as { complete: boolean }).complete) return undefined
          const unresolved = job.store.story.consolidation.pending().filter(item => pending.some(started => started.id === item.id))
          if (unresolved.length > 0) return `these are not resolved yet: ${unresolved.map(item => `${item.id} (${item.kind})`).join(', ')}. Fit them in and resolve each with resolve_consolidation, or submit with complete false and say why`
          const errors = lintWorld(job.store.story).filter(finding => finding.severity === 'error')
          return errors.length === 0 ? undefined : `the world still shows errors:\n${describeFindings(errors).join('\n')}`
        },
        maxCalls: 60 + (given(parent).length > 0 ? EXTERNAL_CALLS : 0),
      })
      if (!result.complete) throw new Error(`not everything could be fitted in: ${result.notes}`)
      return { resolved: pending.filter(item => job.store.story.consolidation.get(item.id)?.resolvedTurn !== undefined).length, notes: result.notes }
    },
  }
}
