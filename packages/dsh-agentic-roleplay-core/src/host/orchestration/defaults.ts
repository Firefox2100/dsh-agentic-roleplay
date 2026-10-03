import type { Character } from 'dsh-roleplay-model'
import type {
  ActivationPlanner, Boundaries, CastMember, CharacterContextProvider, CharacterOutputValidator, CharacterRequest,
  InputValidator, NarrationChecker, Narrator, RetryPolicy, SceneContextProvider,
} from './boundaries.ts'
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

function present(cast: readonly CastMember[], self: string): string {
  return cast.map(({ key, character, state }) => {
    const seen = [state?.publicState, state?.activity].filter(text => text !== undefined && text.trim() !== '')
    return `- ${character.name}${key === self ? ' (you)' : ''}${seen.length > 0 ? `: ${seen.join('; ')}` : ''}`
  }).join('\n')
}

function said(entry: { name: string; utterance?: string; intent: string; result: string; summary: string }): string {
  return `- ${entry.name}${entry.utterance === undefined ? '' : ` said "${entry.utterance}" and`} intended: ${entry.intent} (${entry.result}) ${entry.summary}`
}

/** Every character is told the same thing about the scene, plus who it is. */
export const sharedContext: CharacterContextProvider = {
  brief(request: CharacterRequest) {
    const { member, cast, situation, attempt, earlier, reaction, previous } = request
    const sections = [`Situation:\n${situation}`, `Present:\n${present(cast, member.key)}`]
    if (earlier !== undefined && earlier.length > 0) {
      sections.push(`Earlier in this scene, before this moment:\n${earlier.map(said).join('\n')}`)
    }
    if (attempt === 2 && reaction !== undefined) {
      sections.push(`What just happened, and what you are reacting to:\n${reaction.map(said).join('\n')}`)
      if (previous !== undefined) sections.push(`Your earlier intent did not work out: ${previous.intent}\nYou are trying again, knowing the above. Decide again what you do now.`)
    }
    sections.push(`Decide what ${member.character.name} does now. Answer with what you do (intent), anything you say aloud (utterance, word for word, in your own voice; leave it out if you stay silent), and your commitment: how hard you will keep trying if it does not work out.`)
    return {
      persona: `${describe(member.character)}\n\nYou act only as ${member.character.name} and never describe what other characters do.`,
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

export const castSummary: SceneContextProvider = {
  scene({ cast, turn }) {
    const lines = cast.map(({ key, character, state }) => {
      const role = character.control === 'player' ? 'the player\'s character' : `acts through "${key}"`
      const seen = [state?.publicState, state?.activity].filter(text => text !== undefined && text.trim() !== '')
      return `- ${character.name} (${role})${character.summary === '' ? '' : `: ${character.summary}`}${seen.length > 0 ? ` Currently: ${seen.join('; ')}` : ''}`
    })
    return `Scene before turn ${turn}:\n${lines.join('\n')}`
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

export function defaultBoundaries(): Boundaries {
  return {
    planner: everyoneActs,
    characterContext: sharedContext,
    outputValidator: acceptsAnyIntent,
    retryPolicy: persistentRetry,
    inputValidator: acceptsAnyInput,
    narrator: gameMasterNarrates,
    narrationChecker: exactUtterances,
    sceneContext: castSummary,
  }
}
