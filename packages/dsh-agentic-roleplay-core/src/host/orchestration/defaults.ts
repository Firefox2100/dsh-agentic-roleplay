import type { Character } from 'dsh-roleplay-model'
import type {
  ItemView, KnownRelationship, SceneItems,
  ActivationPlanner, Author, Boundaries, Reflector, Strategist, Suggester, TriggerJudge, TurnStore, CastMember, CharacterContextProvider, Committer, CharacterOutputValidator, CharacterRequest,
  InputValidator, PlaceView, NarrationChecker, Narrator, Recaller, RetryPolicy, SceneContextProvider,
} from './boundaries.ts'
import { describeDuration, locationKey, mentioned, overlap, tokens, MINUTE, type Recalled } from '@dsh-agentic-roleplay/state'
import { answerLimits, type NarrationSegment, type Utterance } from './protocol.ts'
import { referent } from './referent.ts'
import type { AgendaView, SceneAgenda } from '../clock/agenda.ts'
import { describeTime, describeWhen, type StoryTime } from '../clock/story-clock.ts'

/** What the instructions say about how long each part of a character's answer may run. */
const limitVariables = (language: string): { thoughtLimit: number; intentLimit: number; utteranceLimit: number } => {
  const limits = answerLimits(language)
  return { thoughtLimit: limits.thought, intentLimit: limits.intent, utteranceLimit: limits.utterance }
}

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

/** How long the player has to have been away for it to be worth telling the game master. */
const NOTICEABLE_ABSENCE = 5 * MINUTE

/** What the game master is told about time at the start of a turn, and how it passes. */
function timeNotice(time: { now: StoryTime; away?: number }): string {
  const now = `Time: ${describeTime(time.now)}.`
  if (time.now.mode === 'simulated') return `${now} The story's time moves only as you say: each round takes what you give it (elapsed_seconds in resolve_round, or the default), and advance_time skips ahead.`
  const away = time.away !== undefined && time.away >= NOTICEABLE_ABSENCE
    ? ` The player was away for ${describeDuration(time.away)} of real time and the story went on meanwhile: characters have been about their own business, so do not assume anyone is where or as the player left them unless the records say so.`
    : ''
  return `${now} The story's time follows the real clock: it cannot be skipped, and each round takes as long as it really took.${away}`
}

/** What a character is told of its day, its commitments and what it is after. */
export function describeAgenda(agenda: AgendaView, now: number): string[] {
  const { zone } = agenda
  const at = (place: string | undefined): string => (place === undefined ? '' : ` at ${place}`)
  const lines: string[] = []
  if (agenda.now !== undefined) lines.push(`Your day, now: ${agenda.now.activity}${at(agenda.now.place)}, until ${describeWhen(agenda.now.until, now, zone)}${agenda.now.interruptible ? '' : ' (not something you would drop lightly)'}.`)
  if (agenda.next !== undefined) lines.push(`Your day, next: ${agenda.next.activity}${at(agenda.next.place)}, from ${describeWhen(agenda.next.at, now, zone)}.`)
  for (const engagement of agenda.engagements) {
    lines.push(`${engagement.overdue ? 'You were to' : 'You are due to'}: ${engagement.title}${at(engagement.place)}${engagement.with.length === 0 ? '' : `, with ${engagement.with.join(', ')}`}, at ${describeWhen(engagement.at, now, zone)}${engagement.overdue ? ', which has passed and is still open' : ''}.`)
  }
  if (agenda.goals.length > 0) {
    lines.push('What you are after:')
    for (const goal of agenda.goals) lines.push(`- ${goal.name} (${goal.type})${goal.deadline === undefined ? '' : `, by ${describeWhen(goal.deadline, now, zone)}${goal.overdue ? ', which has passed' : ''}`}${goal.description === '' ? '' : `: ${sentence(goal.description)}`}${goal.plan.length === 0 ? '' : ` Next: ${goal.plan.join('; ')}.`}`)
  }
  return lines
}

/** What the game master is told of the characters' days at the start of a turn; nothing when there is nothing to tell. */
export function describeSceneAgenda(agenda: SceneAgenda, now: number): string {
  const lines: string[] = []
  if (agenda.moved.length > 0) lines.push(`By their routines since you last looked: ${agenda.moved.map(move => `${move.name} went to ${move.to} (${move.activity})`).join('; ')}.`)
  if (agenda.here.length > 0) lines.push(`With the player's character, and their days: ${agenda.here.map(entry => `${entry.name}: ${entry.note}`).join('; ')}. The characters decide for themselves whether to keep to their day; the moment may keep them.`)
  if (agenda.engagements.length > 0) {
    lines.push(`Commitments due soon or overdue: ${agenda.engagements.map(engagement => `"${engagement.title}" (${engagement.with.join(', ')}${engagement.place === undefined ? '' : `, at ${engagement.place}`}) ${engagement.overdue ? 'was due' : 'is due'} ${describeWhen(engagement.at, now, agenda.zone)}${engagement.overdue ? ' and is still open' : ''}`).join('; ')}.`)
  }
  return lines.join('\n')
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
    return `- ${key === self ? character.name : referent(character)}${key === self ? ' (you)' : ''}${where === '' ? '' : ` (${where})`}${seen.length > 0 ? `: ${seen.join('; ')}` : ''}`
  }).join('\n')
}

/** A bounded, advisory order for who is most likely to need a turn; reachability still governs activation. */
export function describeActivationCandidates(cast: readonly CastMember[], input: string, story: TurnStore['story']): string {
  const player = cast.find(member => member.character.control === 'player')
  if (player === undefined) return ''
  const named = mentioned(input, cast.map(member => member.character))
  const cues = tokens(input)
  const candidates = cast.filter(member => member.character.control === 'agent').map((member) => {
    const relation = story.relationships.get(member.character.id, player.character.id)
    const here = member.place === undefined || player.place === undefined || member.place.location.id === player.place.location.id
    const goal = story.intents.list(member.character.id, { status: 'active' }).map(intent => ({ intent, match: overlap(cues, `${intent.name} ${intent.description}`, []) })).sort((a, b) => b.match - a.match)[0]
    const factionGoal = story.factionMemberships.ofCharacter(member.character.id, 'active').flatMap(membership => story.factionIntents.list(membership.factionId, { status: 'active' }).map(intent => ({ intent, match: overlap(cues, `${intent.name} ${intent.description}`, []) * membership.commitment }))).sort((a, b) => b.match - a.match)[0]
    const reasons = [named.has(member.character.id) ? 'named in the move' : '', here ? 'in the scene' : '', (goal?.match ?? 0) >= 2 ? `own goal: ${goal!.intent.name}` : '', (factionGoal?.match ?? 0) >= 2 ? `faction pressure: ${factionGoal!.intent.name}` : '', relation !== undefined && relation.tension >= 0.5 ? 'high tension toward the player' : '', relation !== undefined && relation.trust <= -0.4 ? 'distrusts the player' : '', relation !== undefined && Math.abs(relation.affinity) >= 0.4 ? relation.affinity > 0 ? 'cares about the player' : 'dislikes the player' : ''].filter(reason => reason !== '')
    const score = (named.has(member.character.id) ? 4 : 0) + (here ? 2 : 0) + Math.min(2, (goal?.match ?? 0) / 2) + Math.min(2, (factionGoal?.match ?? 0) / 2) + (relation?.tension ?? 0) + Math.max(0, -(relation?.trust ?? 0)) * 0.5 + Math.abs(relation?.affinity ?? 0) * 0.5
    return { member, reasons, score }
  }).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score || a.member.key.localeCompare(b.member.key)).slice(0, 5)
  if (candidates.length === 0) return ''
  return `Likely characters to activate, in priority order (advice only; activate only whoever the moment actually reaches):\n${candidates.map(({ member, reasons }) => `- ${member.character.name} (${member.key}): ${reasons.join(', ') || 'socially implicated'}`).join('\n')}`
}

function said(entry: { name: string; utterance?: string; intent: string; result: string; summary: string }): string {
  return `- ${entry.name}${entry.utterance === undefined ? '' : ` said "${entry.utterance}" and`} intended: ${entry.intent} (${entry.result}) ${entry.summary}`
}

function age(at: number | undefined, now: number | undefined): string {
  if (at === undefined || now === undefined) return 'some time ago'
  const seconds = Math.max(0, Math.floor((now - at) / 1000))
  if (seconds < 60) return 'just now'
  const units = [{ seconds: 86_400, name: 'day' }, { seconds: 3_600, name: 'hour' }, { seconds: 60, name: 'minute' }]
  const unit = units.find(candidate => seconds >= candidate.seconds)!
  const amount = Math.floor(seconds / unit.seconds)
  return `${amount} ${unit.name}${amount === 1 ? '' : 's'} ago`
}

/** What a character remembers, in the way it remembers it: what is faded or vague is told as such. */
function remembered(memories: readonly Recalled[], now?: number): string {
  return memories.map((memory) => {
    const how = memory.clarity === 'clear' ? age(memory.at, now) : `${age(memory.at, now)}, ${memory.clarity === 'faded' ? 'the details are fuzzy' : 'you barely remember'}`
    return `- (${how}${memory.linked === true ? ', it comes to mind with the rest' : ''}) ${memory.text}`
  }).join('\n')
}

/** Every character is told the same thing about the scene, plus who it is and what it remembers. */
export const sharedContext: CharacterContextProvider = {
  brief(request: CharacterRequest) {
    const { member, cast, situation, attempt, earlier, reaction, previous, memories, place, relationships, knowledge, affiliations, carrying, time, agenda } = request
    // In a place, a character perceives who is there with it; in a story without places, everyone is present.
    const company = place === undefined ? cast : place.here
    const sections = [`Situation:\n${situation}`, ...(time === undefined ? [] : [`Now: ${describeTime(time)}.`]), ...(place === undefined ? [] : [`Where you are:\n${describePlace(place, { withKeys: false }).join('\n')}`]), `Present:\n${present(company, member.key)}`]
    if (request.upcoming !== undefined && request.upcoming.length > 0) sections.push(`What you know is coming:\n${request.upcoming.map(entry => `- ${entry.text}${entry.when === undefined ? '' : ` (${entry.when})`}`).join('\n')}`)
    if (request.cues !== undefined && request.cues.length > 0) sections.push(`Just now you notice:\n${request.cues.map(cue => `- ${cue}`).join('\n')}`)
    if (request.tracked !== undefined && request.tracked.self !== '') sections.push(`How you are (what you can tell of yourself):\n${request.tracked.self}`)
    if (request.tracked !== undefined && request.tracked.others.length > 0) sections.push(`What you can tell of the others here:\n${request.tracked.others.map(other => `- ${other.name}: ${other.text}`).join('\n')}`)
    const day = agenda === undefined || time === undefined ? [] : describeAgenda(agenda, time.now)
    if (day.length > 0) sections.push(`Your day and what you are after (plans, not orders: keep them, put them off or drop them as the moment and your character suggest):\n${day.join('\n')}`)
    if (carrying !== undefined && carrying.length > 0) sections.push(`What you have on you:\n${describeItems(carrying, { withKeys: false })}`)
    if (relationships !== undefined && relationships.length > 0) {
      sections.push(`How you stand with people who bear on this moment (your own view, not objective fact):\n${relationships.map((relation) => { const attitude = describeAttitude(relation); return `- ${relation.name}${relation.present ? ' (here)' : ' (not here)'} — ${relation.label}${relation.summary === '' ? '' : `: ${relation.summary}`}${attitude === '' ? '' : ` [${attitude}]`}` }).join('\n')}`)
    }
    if (affiliations !== undefined && affiliations.length > 0) {
      sections.push(`Your affiliations (their goals are pressures and commitments, not commands):\n${affiliations.map((entry) => {
        const position = [entry.role, entry.rank].filter(Boolean).join(', ') || 'member'
        const goals = entry.goals.length === 0 ? '' : ` Goals: ${entry.goals.join('; ')}.`
        const state = entry.publicState === '' ? '' : ` ${entry.publicState}`
        const attitude = entry.relationship === undefined ? '' : describeAttitude(entry.relationship)
        return `- ${entry.name}: ${position}; ${entry.status}; commitment ${entry.commitment.toFixed(2)}.${state}${goals}${attitude === '' ? '' : ` Your view: ${attitude}.`}`
      }).join('\n')}`)
    }
    if (knowledge !== undefined) {
      const shown = (entries: readonly string[]): string => entries.slice(0, 30).join('; ') + (entries.length > 30 ? `; and ${entries.length - 30} more you can recall if needed` : '')
      const lines = [
        knowledge.characters.length === 0 ? undefined : `People: ${shown(knowledge.characters)}`,
        knowledge.factions.length === 0 ? undefined : `Factions: ${shown(knowledge.factions)}`,
        knowledge.locations.length === 0 ? undefined : `Places: ${shown(knowledge.locations)}`,
        knowledge.routes.length === 0 ? undefined : `Routes: ${shown(knowledge.routes)}`,
        knowledge.items.length === 0 ? undefined : `Things: ${shown(knowledge.items)}`,
      ].filter((line): line is string => line !== undefined)
      if (lines.length > 0) sections.push(`What you know exists (this does not tell you where it is now or what state it is in):\n${lines.join('\n')}`)
    }
    if (memories !== undefined && memories.length > 0) {
      sections.splice(1, 0, `What you remember that bears on this (only what you took in yourself; do not claim to remember more, and be unsure of what is fuzzy):\n${remembered(memories, time?.now)}`)
    } else if (memories !== undefined) {
      sections.splice(1, 0, 'What you remember that bears on this: nothing comes to mind.')
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
        request.text('roleplay/character-rules', { name: member.character.name }),
        request.text('roleplay/character-style', { name: member.character.name }),
        ...(request.lookup ? [request.text('roleplay/character-lookup')] : []),
        request.text('roleplay/character-decide', { name: member.character.name, ...limitVariables(request.language ?? 'en') }),
      ].join('\n\n'),
      prompt: sections.join('\n\n'),
    }
  },
}

/**
 * Whoever is with the player's character acts, unless the game master names who (it always does in play). While the world has places, a character that is in none
 * is not part of the scene: asking it to act is refused, so that someone the story never placed cannot answer from nowhere. (A character in
 * another place can be asked when the moment reaches it.)
 */
export const everyoneActs: ActivationPlanner = {
  plan({ cast, requested }) {
    const placed = cast.some(member => member.place !== undefined)
    const available = cast.filter(member => member.character.control === 'agent')
    const here = cast.find(member => member.character.control === 'player')?.place?.location.id
    const inScene = (member: CastMember): boolean => !placed || member.place !== undefined
    if (requested === undefined || requested.length === 0) return available.filter(member => (placed && here !== undefined ? member.place?.location.id === here : inScene(member))).map(member => member.key)
    const unknown = requested.filter(key => !available.some(member => member.key === key))
    if (unknown.length > 0) throw new Error(`cannot activate ${unknown.join(', ')}: not a character that acts on its own (available: ${available.map(member => member.key).join(', ')})`)
    const nowhere = [...new Set(requested)].map(key => available.find(member => member.key === key)!).filter(member => !inScene(member))
    if (nowhere.length > 0) throw new Error(`cannot activate ${nowhere.map(member => member.key).join(', ')}: in no place, so not part of this scene. Only characters that have a place act (${available.filter(inScene).map(member => member.key).join(', ') || 'nobody'}); leave the others out`)
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
  if (nowhere.length > 0) sections.push(`Characters with no place (not part of this scene; they cannot be asked to act):\n${nowhere.map(describeMember).join('\n')}`)
  return sections.join('\n\n')
}

export const castSummary: SceneContextProvider = {
  scene({ tracked, time, world, cast, turn, input, queryVector, story, items }) {
    const describeMember = (member: CastMember): string => {
      const { key, character, state } = member
      const role = character.control === 'player' ? `the player's character, "${key}"` : `acts through "${key}"`
      const seen = [state?.publicState, state?.activity].filter(text => text !== undefined && text.trim() !== '')
      const where = whereIs(member)
      return `- ${referent(character)} (${role})${where === '' ? '' : ` [${where}]`}${character.summary === '' ? '' : `: ${character.summary}`}${seen.length > 0 ? ` Currently: ${seen.join('; ')}` : ''}`
    }
    const player = cast.find(member => member.character.control === 'player')
    const days = time?.agenda === undefined ? '' : describeSceneAgenda(time.agenda, time.now.now)
    const parts = [...(time === undefined ? [] : [timeNotice(time)]), ...(days === '' ? [] : [days]), `Scene before turn ${turn}:\n${cast.some(member => member.place !== undefined) ? placedScene(cast, player, story, describeMember, items) : cast.map(describeMember).join('\n')}`]
    const activation = describeActivationCandidates(cast, input, story)
    if (activation !== '') parts.push(activation)
    if (items !== undefined) {
      const carried = cast.flatMap(member => { const mine = items.carried(member.character.id); return mine.length === 0 ? [] : [`- ${member.character.name} (${member.key}): ${describeItems(mine, { withKeys: true })}`] })
      if (carried.length > 0) parts.push(`What characters have on them:\n${carried.join('\n')}`)
    }
    if (world !== undefined && world.happened.length > 0) parts.push(`The world acted since the last turn, by itself:\n${world.happened.map(line => `- ${line}`).join('\n')}`)
    if (world?.upcoming !== undefined && world.upcoming.length > 0) parts.push(`Known beforehand, still to come (who knows of it; it will happen by itself when its time comes):\n${world.upcoming.map(entry => `- ${entry.text}${entry.when === undefined ? '' : ` (${entry.when})`} [known to ${entry.who}]`).join('\n')}`)
    if (world !== undefined && world.beats.length > 0) parts.push(`Weave these into the story when it fits, then say you did with addressed in narrate (each stays for a few turns and is then let go):\n${world.beats.map(beat => `- [${beat.id}] ${beat.text}`).join('\n')}`)
    if (tracked !== undefined && tracked.length > 0) parts.push(`What the story keeps track of (change it with variable_changes in an outcome when what happened calls for it):\n${tracked.map(line => `- ${line}`).join('\n')}`)
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

const sameCharacter = (utterance: Utterance, character: string): boolean => utterance.character === character || utterance.name === character

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
  recall: ({ member, situation, turn, policy, queryVector, explain }, story, signal) =>
    story.recallRanked({ characterId: member.character.id, situation, turn, policy, ...(explain === true ? { explain } : {}), ...(member.place === undefined ? {} : { locationId: member.place.location.id }) }, signal, queryVector === undefined ? {} : { queryVector }),
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

/** Lets no organisation act: without a strategist factions change only through what the story records. */
export const factionsStayPut: Strategist = { strategize: () => Promise.resolve({ acted: [] }) }

/** Reflects on nothing: without a reflector what characters believe changes only through what the story records. */
export const reflectsOnNothing: Reflector = { reflect: () => Promise.resolve({ characters: [] }) }

/** Judges nothing: without a judge a trigger that waits on a statement never sees it hold. */
export const judgesNothing: TriggerJudge = { judge: () => Promise.resolve({ judged: 0 }) }

/** Offers nothing: without a suggester the player writes their own move. */
export const offersNothing: Suggester = { suggest: () => Promise.resolve([]) }

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
    strategist: factionsStayPut,
    reflector: reflectsOnNothing,
    judge: judgesNothing,
    suggester: offersNothing,
    recaller: recordsRecall,
    sceneContext: castSummary,
  }
}
