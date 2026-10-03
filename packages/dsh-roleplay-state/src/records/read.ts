import type { CharacterId } from 'dsh-roleplay-model'
import { characterKey, type RecordsTarget } from './edit.ts'

/** Which part of the story's records to read; all of it when left out. */
export interface RecordsScope {
  rounds?: readonly { turn: number; round: number }[]
}

/** The records as models read them (snake_case, characters by key), the counterpart of the edit's wire format. */
export interface RecordsView {
  characters: {
    character: string
    name: string
    controlled_by: 'the player' | 'an agent'
    public_state: string
    inner_state: string
    activity: string
    emotion: { valence: number; arousal: number; dominance: number } | null
  }[]
  events: {
    id: number
    turn: number
    round: number
    text: string
    importance: number
    tags: string[]
    involves: string[]
    perceived_by: { character: string; mode: string; accuracy: string; content: string; gist: string }[]
  }[]
  beliefs: { id: number; character: string; kind: string; text: string; about: string[]; importance: number; turn: number }[]
  open_threads: { id: number; text: string; opened_turn: number }[]
}

/** Read the records back from the database, as the edit wrote them. */
export function readRecords(target: Omit<RecordsTarget, 'transaction'>, scope: RecordsScope = {}): RecordsView {
  const characters = target.characters.list()
  const keyOf = (id: CharacterId): string => {
    const found = characters.find(character => character.id === id)
    return found === undefined ? String(id) : characterKey(found)
  }
  const inScope = (turn: number, round?: number): boolean =>
    scope.rounds === undefined || scope.rounds.some(entry => entry.turn === turn && (round === undefined || entry.round === round))
  return {
    characters: characters.map((character) => {
      const state = target.characterStates.get(character.id)
      return {
        character: characterKey(character),
        name: character.name,
        controlled_by: character.control === 'player' ? 'the player' : 'an agent',
        public_state: state?.publicState ?? '',
        inner_state: state?.innerState ?? '',
        activity: state?.activity ?? '',
        emotion: state?.emotion === undefined ? null : { ...state.emotion.immediate },
      }
    }),
    events: target.events.list().filter(event => inScope(event.turn, event.round)).map(event => ({
      id: event.id, turn: event.turn, round: event.round, text: event.text, importance: event.importance, tags: event.tags,
      involves: event.involves.map(keyOf),
      perceived_by: target.events.perceptionsOf(event.id).map(entry => ({ character: keyOf(entry.characterId), mode: entry.mode, accuracy: entry.accuracy, content: entry.content, gist: entry.gist })),
    })),
    beliefs: characters.flatMap(character => target.memories.list(character.id)
      .filter(belief => inScope(belief.turn))
      .map(belief => ({ id: belief.id, character: characterKey(character), kind: belief.kind, text: belief.text, about: belief.about.map(keyOf), importance: belief.importance, turn: belief.turn }))),
    open_threads: target.threads.list('open').map(thread => ({ id: thread.id, text: thread.text, opened_turn: thread.openedTurn })),
  }
}
