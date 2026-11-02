import { describeValue, shownVariables, type Session } from '@dsh-agentic-roleplay/state'
import { PROFILE_MEMORY_LIMIT, type ReferenceAudience, type ReferenceProfile } from '../../shared/reference.ts'

export type ProfileSession = Pick<Session, 'characters' | 'characterStates' | 'intents' | 'events' | 'memories' | 'factions' | 'factionMemberships' | 'variables' | 'items' | 'locations'>
type Character = ReturnType<ProfileSession['characters']['list']>[number]

export const keyOf = (character: { id: number; sourceId?: string }): string => character.sourceId ?? String(character.id)

interface Block {
  /** Who may read it. The one place that decides what a profile shows to whom. */
  audiences: readonly ReferenceAudience[]
  build(session: ProfileSession, character: Character, audience: ReferenceAudience): Partial<ReferenceProfile>
}

const BLOCKS: readonly Block[] = [
  {
    audiences: ['self', 'observer'],
    build: (session, character, audience) => {
      const state = session.characterStates.get(character.id)
      return {
        aliases: character.aliases,
        ...character.age === undefined || character.age === null ? {} : { age: character.age },
        ...character.gender === undefined || character.gender === null ? {} : { gender: character.gender },
        ...character.pronouns === undefined || character.pronouns === null ? {} : { pronouns: character.pronouns },
        appearance: character.appearance,
        publicState: state?.publicState ?? '',
        values: shownVariables(session, 'character', character.id, keyOf(character), audience === 'self' ? 'self' : 'others').map(({ variable, value }) => ({ name: variable.name, value: describeValue(variable, value) })),
      }
    },
  },
  {
    audiences: ['self'],
    build: (session, character) => {
      const state = session.characterStates.get(character.id)
      const groups = session.factionMemberships.ofCharacter(character.id, 'active').flatMap((membership) => {
        const faction = session.factions.get(membership.factionId)
        return faction === undefined ? [] : [{ name: faction.name, role: membership.role }]
      })
      return {
        summary: character.summary,
        personality: character.personality,
        background: character.background,
        speech: character.speech,
        innerState: state?.innerState ?? '',
        activity: state?.activity ?? '',
        groups,
        goals: session.intents.list(character.id, { status: 'active' }).map(intent => ({ name: intent.name, description: intent.description, status: intent.status, plan: intent.plan, ...intent.deadline === undefined ? {} : { deadline: intent.deadline } })),
      }
    },
  },
  {
    audiences: ['self'],
    build: (session, character) => {
      const recollections = session.events.perceivedBy(character.id).sort((a, b) => b.event.turn - a.event.turn || b.event.round - a.event.round)
      const beliefs = session.memories.list(character.id).sort((a, b) => b.turn - a.turn)
      return {
        // The perception's accuracy is left out: the character does not know whether it was right.
        recollections: recollections.slice(0, PROFILE_MEMORY_LIMIT).map(({ perception, event }) => ({ text: perception.content, gist: perception.gist, mode: perception.mode, turn: event.turn })),
        beliefs: beliefs.slice(0, PROFILE_MEMORY_LIMIT).map(memory => ({ text: memory.text, kind: memory.kind, confidence: memory.confidence, turn: memory.turn })),
        totals: { recollections: recollections.length, beliefs: beliefs.length },
      }
    },
  },
]

/** A character as the audience may see them: only the blocks that audience is allowed. */
export function profileOf(session: ProfileSession, character: Character, audience: ReferenceAudience): ReferenceProfile {
  const profile: ReferenceProfile = { key: keyOf(character), name: character.name, audience, aliases: [], appearance: '', publicState: '', values: [] }
  for (const block of BLOCKS) if (block.audiences.includes(audience)) Object.assign(profile, block.build(session, character, audience))
  return profile
}
