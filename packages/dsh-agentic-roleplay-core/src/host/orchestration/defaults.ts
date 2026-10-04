import type { Character } from 'dsh-roleplay-model'
import type {
  ItemView, KnownRelationship, SceneItems,
  ActivationPlanner, Author, Boundaries, TurnStore, CastMember, CharacterContextProvider, Committer, CharacterOutputValidator, CharacterRequest,
  InputValidator, PlaceView, NarrationChecker, Narrator, Recaller, RetryPolicy, SceneContextProvider,
} from './boundaries.ts'
import { locationKey, mentioned, overlap, tokens, type Recalled } from 'dsh-roleplay-state'
import type { NarrationSegment, Utterance } from './protocol.ts'

function describe(character: Character): string {
  const lines = [`You are ${character.name}.`]
  if (character.aliases.length > 0) lines.push(`You are also called ${character.aliases.join(', ')}.`)
  const facts = [
    character.age === undefined ? undefined : `age: ${character.age}`,
    character.gender === undefined ? undefined : `gender: ${character.gender}`,
    character.pronouns === undefined ? undefined : `pronouns: ${character.pronouns}`,
  ].filter(fact => fact !== undefined)
  if (facts.length > 0) lines.push(facts.join('; ') + '.')
  for (const [label, text] of [
    ['Summary', character.summary], ['Personality', character.personality],
    ['Background', character.background], ['Appearance', character.appearance],
    ['How you speak', character.speech.style],
  ] as const) {
    if (text.trim() !== '') lines.push(`${label}: ${text.trim()}`)
  }
  return lines.join('\n')
}

/** At most this many features and ways out of a place are told at once. */
const SHOWN_FEATURES = 12
const SHOWN_EXITS = 12

const sentence = (text: string): string => {
  const match = /^[^.!?。！？]*[.!?。！？]?/u.exec(text.trim())
  return (match?.[0] ?? text).trim()
}

/** At most this many things are listed at once: the rest are said to be there and left for a closer look. */
const SHOWN_ITEMS = 12

/** One thing in a sentence: how many, what state it is in, where it is. */
export function describeItem(item: ItemView, { withKeys }: { withKeys: boolean }): string {
  const name = `${item.quantity > 1 ? `${item.quantity} ` : ''}${item.name}${item.quality === '' ? '' : ` (${item.quality})`}`
  const extra = [item.hidden ? 'hidden' : '', item.state === undefined ? '' : item.state, item.where ?? ''].filter(part => part !== '').join(', ')
  const inside = item.contents === undefined ? '' : ` holding ${item.contents.join(', ')}`
  return `${withKeys ? `${item.key}: ` : ''}${name}${extra === '' ? '' : ` [${extra}]`}${inside}`
}

/** A list of things, capped. */
export function describeItems(items: readonly ItemView[], options: { withKeys: boolean }): string {
  return `${items.slice(0, SHOWN_ITEMS).map(item => describeItem(item, options)).join('; ')}${items.length > SHOWN_ITEMS ? `; and ${items.length - SHOWN_ITEMS} more` : ''}`
}

/** What someone in a place is told about it: what it is like, what can be pointed at, and the ways out. */
export function describePlace(view: PlaceView, { withKeys }: { withKeys: boolean }): string[] {
  const { location, exits } = view
  const lines = [`${location.name}${withKeys ? ` (${view.key})` : ''}${location.description === '' ? '' : `: ${location.description}`}`]
  if (location.features.length > 0) {
    const shown = location.features.slice(0, SHOWN_FEATURES).map(feature => `${withKeys ? `${feature.key}: ` : ''}${feature.name}${feature.description === '' ? '' : ` - ${sentence(feature.description)}`}`)
    lines.push(`Things here: ${shown.join('; ')}${location.features.length > SHOWN_FEATURES ? `; and ${location.features.length - SHOWN_FEATURES} more` : ''}`)
  }
  if (exits.length > 0) {
    const shown = exits.slice(0, SHOWN_EXITS).map(({ key, name, exit }) => `${withKeys ? `${key}: ` : ''}${name}${exit.description === '' ? '' : ` (${sentence(exit.description)})`}${exit.state === 'open' ? '' : ` [${exit.state}${exit.note === '' ? '' : `: ${exit.note}`}]`}`)
    lines.push(`Ways out: ${shown.join('; ')}${exits.length > SHOWN_EXITS ? `; and ${exits.length - SHOWN_EXITS} more` : ''}`)
  }
  if (view.items !== undefined && view.items.length > 0) lines.push(`Lying about: ${describeItems(view.items, { withKeys })}`)
  return lines
}

/** In words, how a character stands with another, from the numbers of its profile; nothing for what is unremarkable. */
export function describeAttitude(relation: Pick<KnownRelationship, 'familiarity' | 'trust' | 'affinity' | 'tension'>): string {
  return [
    relation.familiarity >= 0.7 ? 'knows them well' : relation.familiarity <= 0.15 ? 'barely knows them' : '',
    relation.trust >= 0.4 ? 'trusts them' : relation.trust <= -0.4 ? 'distrusts them' : '',
    relation.affinity >= 0.4 ? 'is fond of them' : relation.affinity <= -0.4 ? 'dislikes them' : '',
    relation.tension >= 0.5 ? 'things are strained between them' : '',
  ].filter(part => part !== '').join(', ')
}

function whereIs(member: CastMember): string {
  const place = member.place
  if (place === undefined) return ''
  return [place.position, place.feature === undefined ? '' : `at ${place.feature.name}`].filter(part => part !== '').join(', ')
}

function present(cast: readonly CastMember[], self: string): string {
  return cast.map((member) => {
    const { key, character, state } = member
    const seen = [state?.publicState, state?.activity].filter(text => text !== undefined && text.trim() !== '')
    const where = whereIs(member)
    return `- ${character.name}${key === self ? ' (you)' : ''}${where === '' ? '' : ` (${where})`}${seen.length > 0 ? `: ${seen.join('; ')}` : ''}`
  }).join('\n')
}

function said(entry: { name: string; utterance?: string; intent: string; result: string; summary: string }): string {
  return `- ${entry.name}${entry.utterance === undefined ? '' : ` said "${entry.utterance}" and`} intended: ${entry.intent} (${entry.result}) ${entry.summary}`
}

function age(turn: number, now: number): string {
  const ago = now - turn
  return ago <= 2 ? 'just now' : ago <= 15 ? 'a while ago' : 'long ago'
}

/** What a character remembers, in the way it remembers it: what is faded or vague is told as such. */
function remembered(memories: readonly Recalled[], now: number): string {
  return memories.map((memory) => {
    if (memory.clarity === 'clear') return `- (${age(memory.turn, now)}) ${memory.text}`
    if (memory.clarity === 'faded') return `- (${age(memory.turn, now)}, the details are fuzzy) ${memory.text}`
    return `- (${age(memory.turn, now)}, you barely remember) ${memory.text}`
  }).join('\n')
}

/** Every character is told the same thing about the scene, plus who it is and what it remembers. */
export const sharedContext: CharacterContextProvider = {
  brief(request: CharacterRequest) {
    const { member, cast, situation, attempt, earlier, reaction, previous, memories, turn, place, relationships, carrying } = request
    // In a place, a character perceives who is there with it; in a story without places, everyone is present.
    const company = place === undefined ? cast : place.here
    const sections = [`Situation:\n${situation}`, ...(place === undefined ? [] : [`Where you are:\n${describePlace(place, { withKeys: false }).join('\n')}`]), `Present:\n${present(company, member.key)}`]
    if (carrying !== undefined && carrying.length > 0) sections.push(`What you have on you:\n${describeItems(carrying, { withKeys: false })}`)
    if (relationships !== undefined && relationships.length > 0) {
      sections.push(`How you stand with those here (your own view of them):\n${relationships.map((relation) => { const attitude = describeAttitude(relation); return `- ${relation.name} (${relation.label})${relation.summary === '' ? '' : `: ${relation.summary}`}${attitude === '' ? '' : ` [${attitude}]`}` }).join('\n')}`)
    }
    if (memories !== undefined && memories.length > 0) {
      sections.splice(1, 0, `What you remember that bears on this (only what you took in yourself; do not claim to remember more, and be unsure of what is fuzzy):\n${remembered(memories, turn)}`)
    }
    if (earlier !== undefined && earlier.length > 0) {
      sections.push(`Earlier in this scene, before this moment:\n${earlier.map(said).join('\n')}`)
    }
    if (attempt === 2 && reaction !== undefined) {
      sections.push(`What just happened, and what you are reacting to:\n${reaction.map(said).join('\n')}`)
      if (previous !== undefined) sections.push(`Your earlier intent did not work out: ${previous.intent}\nYou are trying again, knowing the above. Decide again what you do now.`)
    }
    // Everything that stays the same from one activation to the next is in the persona, which
    // starts every request; only what changes is in the prompt, so the provider's cache holds.
    return {
      persona: [
        describe(member.character),
        `Rules that always hold: you act only as ${member.character.name}. You know only what is in the situation you are given, who is present and what you remember; never use anything else, and do not claim to remember more. You never describe, decide or speak for another character, and you never narrate the world. Stay in character.`,
        ...(request.lookup ? ['If you need to remember something that the situation does not give you, ask yourself with recall_my_memories. Do not use it otherwise.'] : []),
        `Each time you are asked, decide what ${member.character.name} does now and answer with exactly three things: intent (one action, in one or two sentences, no speech), utterance (the words said aloud, word for word, in your own voice; leave it out if you stay silent) and commitment (low gives up at once, medium tries again if it is easy, high persists).`,
      ].join('\n\n'),
      prompt: sections.join('\n\n'),
    }
  },
}

/** Everyone the player does not control acts, unless the game master names who. */
export const everyoneActs: ActivationPlanner = {
  plan({ cast, requested }) {
    const available = cast.filter(member => member.character.control === 'agent')
    if (requested === undefined || requested.length === 0) return available.map(member => member.key)
    const unknown = requested.filter(key => !available.some(member => member.key === key))
    if (unknown.length > 0) throw new Error(`cannot activate ${unknown.join(', ')}: not a character that acts on its own (available: ${available.map(member => member.key).join(', ')})`)
    return [...new Set(requested)]
  },
}

export const acceptsAnyIntent: CharacterOutputValidator = {
  validate: ({ intent }) => (intent.trim() === '' ? { ok: false, reason: 'the intent is empty' } : { ok: true }),
}

/** A character whose intent failed and who is highly committed tries once more. */
export const persistentRetry: RetryPolicy = {
  select({ reports, outcomes }) {
    return reports
      .filter(report => report.commitment === 'high' && outcomes.some(outcome => outcome.character === report.character && outcome.result === 'failed'))
      .map(report => report.character)
  },
}

export const acceptsAnyInput: InputValidator = { validate: () => ({ ok: true }) }

/** The game master narrates. */
export const gameMasterNarrates: Narrator = { narrate: () => Promise.resolve(undefined) }

/** Compares what was said, ignoring the quotes around it and the way whitespace is laid out. */
const WRAPPING_QUOTES = /^["“”„«»'‘’]+|["“”„«»'‘’]+$/g
export function sameWords(a: string, b: string): boolean {
  const plain = (text: string): string => text.trim().replace(WRAPPING_QUOTES, '').replace(/\s+/g, ' ').trim()
  return plain(a) === plain(b)
}

/** How many earlier events the game master is reminded of at most. */
const REMINDED_EVENTS = 5

/**
 * The state of the scene, what is still open in the story, and the earlier events that the
 * player's move brings to mind (by the session's search of words and meaning, and by who is named):
 * those already folded out of the conversation into the summaries, whose detail the summaries may have lost.
 */
/** Where the player is and what is there, who is with them, and who is elsewhere. */
function placedScene(cast: readonly CastMember[], player: CastMember | undefined, story: TurnStore['story'], describeMember: (member: CastMember) => string, things?: SceneItems): string {
  const here = player?.place?.location
  const sections: string[] = []
  if (here !== undefined) {
    const view: PlaceView = {
      key: locationKey(here), location: here, here: cast.filter(member => member.place?.location.id === here.id),
      ...(things === undefined ? {} : { items: things.at(here.id) }),
      exits: story.locations.exitsFrom(here.id).flatMap((exit) => { const to = story.locations.get(exit.toId); return to === undefined ? [] : [{ key: locationKey(to), name: to.name, exit }] }),
    }
    sections.push(`The player's character is in ${describePlace(view, { withKeys: true }).join('\n')}`)
    sections.push(`Characters here:\n${view.here.map(describeMember).join('\n')}`)
  }
  const elsewhere = cast.filter(member => member.place !== undefined && member.place.location.id !== here?.id)
  if (elsewhere.length > 0) sections.push(`Characters elsewhere (they perceive nothing here unless the moment reaches them):\n${elsewhere.map(member => `${describeMember(member)} - in ${member.place!.location.name} (${locationKey(member.place!.location)})`).join('\n')}`)
  const nowhere = cast.filter(member => member.place === undefined)
  if (nowhere.length > 0) sections.push(`Characters with no place yet:\n${nowhere.map(describeMember).join('\n')}`)
  return sections.join('\n\n')
}

export const castSummary: SceneContextProvider = {
  scene({ cast, turn, input, queryVector, story, items }) {
    const describeMember = (member: CastMember): string => {
      const { key, character, state } = member
      const role = character.control === 'player' ? 'the player\'s character' : `acts through "${key}"`
      const seen = [state?.publicState, state?.activity].filter(text => text !== undefined && text.trim() !== '')
      const where = whereIs(member)
      return `- ${character.name} (${role})${where === '' ? '' : ` [${where}]`}${character.summary === '' ? '' : `: ${character.summary}`}${seen.length > 0 ? ` Currently: ${seen.join('; ')}` : ''}`
    }
    const player = cast.find(member => member.character.control === 'player')
    const parts = [`Scene before turn ${turn}:\n${cast.some(member => member.place !== undefined) ? placedScene(cast, player, story, describeMember, items) : cast.map(describeMember).join('\n')}`]
    if (items !== undefined) {
      const carried = cast.flatMap(member => { const mine = items.carried(member.character.id); return mine.length === 0 ? [] : [`- ${member.character.name} (${member.key}): ${describeItems(mine, { withKeys: true })}`] })
      if (carried.length > 0) parts.push(`What characters have on them:\n${carried.join('\n')}`)
    }
    const threads = story.threads.list('open')
    if (threads.length > 0) parts.push(`Still open in the story:\n${threads.map(thread => `- ${thread.text}`).join('\n')}`)
    const folded = story.summaries.list().reduce((latest, summary) => Math.max(latest, summary.toTurn), 0)
    if (folded > 0) {
      const mentionedIds = mentioned(input, cast.map(({ character }) => character))
      const cues = tokens(input)
      const names = new Map(cast.map(({ character }) => [character.id, character.name]))
      const byMeaning = story.searchEvents({ text: input, ...(queryVector === undefined ? {} : { vector: queryVector }), toTurn: folded, limit: REMINDED_EVENTS })
      const byCues = story.events.list({ toTurn: folded })
        .filter(event => !byMeaning.some(found => found.id === event.id))
        .map(event => ({ event, score: 3 * event.involves.filter(id => mentionedIds.has(id)).length + overlap(cues, event.text, event.tags) }))
        .filter(({ score }) => score >= 2)
        .sort((a, b) => b.score + 0.5 * b.event.importance - a.score - 0.5 * a.event.importance || b.event.turn - a.event.turn)
        .map(({ event }) => event)
      const relevant = [...byMeaning, ...byCues].slice(0, REMINDED_EVENTS).sort((a, b) => a.turn - b.turn).map(event => ({ event }))
      if (relevant.length > 0) {
        parts.push(`Earlier events that bear on what the player just did (from the records of the story):\n${relevant.map(({ event }) => {
          const who = event.involves.map(id => names.get(id)).filter(name => name !== undefined).join(', ')
          return `- (turn ${event.turn}) ${event.text}${who === '' ? '' : ` [${who}]`}`
        }).join('\n')}`)
      }
    }
    return parts.join('\n\n')
  },
}

const sameCharacter = (utterance: Utterance, character: string): boolean => utterance.character === character

/** Every utterance appears once, exactly as given and in the order spoken, and no one speaks who did not. */
export const exactUtterances: NarrationChecker = {
  check(segments, required) {
    const problems: string[] = []
    const used = new Set<number>()
    let latest = 0
    segments.forEach((segment, index) => {
      const at = `segment ${index + 1}`
      if (segment.type === 'narration') {
        if (segment.text.trim() === '') problems.push(`${at}: the narration is empty`)
        return
      }
      const own = required.flatMap((utterance, position) => (sameCharacter(utterance, segment.character) ? [position] : []))
      const free = own.filter(position => !used.has(position))
      const exact = free.find(position => sameWords(segment.text, required[position]!.text))
      if (exact !== undefined) {
        used.add(exact)
        const spoken = required[exact]!
        if (spoken.round < latest) problems.push(`${at}: the utterance of ${spoken.name} from round ${spoken.round} comes after one from a later round; utterances keep the order they were spoken in`)
        latest = Math.max(latest, spoken.round)
      } else if (free.length > 0) {
        used.add(free[0]!)
        problems.push(`${at}: the utterance of ${required[free[0]!]!.name} was changed; it must be exactly "${required[free[0]!]!.text}"`)
      } else if (own.length > 0) {
        problems.push(`${at}: ${required[own[0]!]!.name} has no more utterances to say; this one is repeated or invented, remove it`)
      } else {
        problems.push(`${at}: ${segment.character} has nothing to say this turn, so this utterance is invented; remove it`)
      }
    })
    required.forEach((utterance, position) => {
      if (!used.has(position)) problems.push(`the utterance of ${utterance.name}${utterance.round > 1 ? ` (round ${utterance.round})` : ''} is missing; it must appear exactly as "${utterance.text}"`)
    })
    return problems
  },

  repair(segments, required) {
    const used = new Set<number>()
    const kept: { segment: NarrationSegment; round: number | undefined }[] = []
    for (const segment of segments) {
      if (segment.type === 'narration') {
        if (segment.text.trim() !== '') kept.push({ segment, round: undefined })
        continue
      }
      const free = required.flatMap((utterance, position) => (sameCharacter(utterance, segment.character) && !used.has(position) ? [position] : []))
      const position = free.find(candidate => sameWords(segment.text, required[candidate]!.text)) ?? free[0]
      if (position === undefined) continue
      used.add(position)
      const spoken = required[position]!
      kept.push({ segment: { type: 'utterance', character: spoken.character, name: spoken.name, text: spoken.text }, round: spoken.round })
    }
    required.forEach((utterance, position) => {
      if (used.has(position)) return
      const restored: NarrationSegment = { type: 'utterance', character: utterance.character, name: utterance.name, text: utterance.text }
      const later = kept.findIndex(entry => entry.round !== undefined && entry.round > utterance.round)
      kept.splice(later < 0 ? kept.length : later, 0, { segment: restored, round: utterance.round })
    })
    return kept.map(entry => entry.segment)
  },
}

/** What a character is reminded of is what the story's records bring back for it: by the cues of the moment, by its words, and by its meaning when vectors exist. */
export const recordsRecall: Recaller = {
  recall: ({ member, situation, turn, policy, queryVector }, story, signal) =>
    story.recallRanked({ characterId: member.character.id, situation, turn, policy, ...(member.place === undefined ? {} : { locationId: member.place.location.id }) }, signal, queryVector === undefined ? {} : { queryVector }),
}

/**
 * Writes no memory. What the game master decided about each character is applied when the round is
 * recorded, so without a memory keeper the story keeps its states and no events.
 */
export const writesNothing: Committer = {
  commit: () => Promise.resolve({ writes: 0, notes: '' }),
}

/** Makes up nothing, and has nothing to fit in: without a world author the world stays as it was written. */
export const declinesToAuthor: Author = {
  create: () => Promise.resolve({ created: [], declined: 'no world author is installed, so the world cannot grow' }),
  consolidate: () => Promise.resolve({ resolved: 0, notes: '' }),
}

export function defaultBoundaries(): Boundaries {
  return {
    planner: everyoneActs,
    characterContext: sharedContext,
    outputValidator: acceptsAnyIntent,
    retryPolicy: persistentRetry,
    inputValidator: acceptsAnyInput,
    narrator: gameMasterNarrates,
    narrationChecker: exactUtterances,
    committer: writesNothing,
    author: declinesToAuthor,
    recaller: recordsRecall,
    sceneContext: castSummary,
  }
}
