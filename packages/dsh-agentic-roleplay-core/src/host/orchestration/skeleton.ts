import type { NewEvent, PerceivedBy } from '@dsh-agentic-roleplay/state'
import type { CommitEntry, RoundRecord } from './boundaries.ts'

const PLAIN_IMPORTANCE = 2
const CONSEQUENTIAL_IMPORTANCE = 3

/** Who took in what an entry did: the people in the same place, the actor included; off stage, only those named in the round. */
function witnesses(round: RoundRecord, entry: CommitEntry): string[] {
  const here = entry.at?.key
  if (here === undefined) return round.entries.map(other => other.character)
  const people = round.present ?? round.entries.flatMap(other => (other.at === undefined ? [] : [{ character: other.character, place: other.at.key }]))
  return [...new Set([entry.character, ...people.filter(person => person.place === here).map(person => person.character)])]
}

/**
 * The records a round always leaves, written without a model: one event for what each character
 * did and one for what it said, word for word. What the game master said bystanders can see is
 * all they take in of the act; the keeper only enriches these (importance, tags, threads,
 * misperception), so a failed run leaves plainer records, never missing ones.
 */
export function skeletonEvents(round: RoundRecord): NewEvent[] {
  return round.entries.flatMap((entry): NewEvent[] => {
    const seen = witnesses(round, entry)
    const base = { turn: round.turn, round: round.round, tags: [], ...(entry.at === undefined ? {} : { location: entry.at.key }) }
    const act: PerceivedBy[] = seen.map(character => (character === entry.character || entry.publicState === undefined
      ? { character, mode: 'witnessed' }
      : { character, mode: 'witnessed', content: entry.publicState, accuracy: 'partial' }))
    const events: NewEvent[] = [{
      ...base, text: entry.summary, importance: entry.moved !== undefined || entry.items !== undefined ? CONSEQUENTIAL_IMPORTANCE : PLAIN_IMPORTANCE,
      involves: [entry.character], perceivedBy: act,
    }]
    if (entry.utterance !== undefined && entry.spoken) {
      events.push({
        ...base, text: `${entry.name}: "${entry.utterance}"`, importance: PLAIN_IMPORTANCE, involves: [entry.character],
        perceivedBy: seen.map(character => ({ character, mode: character === entry.character ? 'witnessed' : 'heard' })),
      })
    }
    return events
  })
}
