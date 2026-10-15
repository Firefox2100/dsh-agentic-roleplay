import type { Session } from '@dsh-agentic-roleplay/state'
import { readWithdrawn } from '../triggers/deliver.ts'
import { MAX_INTERVENTIONS, type Intervention } from '../../shared/interventions.ts'

type InterventionSession = Pick<Session, 'triggers' | 'characters' | 'metadata'>

/** What the story's triggers delivered lately and what became of each, oldest first. */
export function readInterventions(session: InterventionSession): Intervention[] {
  const withdrawn = readWithdrawn(session)
  return session.triggers.notes().slice(-MAX_INTERVENTIONS).map((note): Intervention => {
    const reason = note.status === 'lapsed' ? withdrawn[note.id] : undefined
    return {
      turn: note.turn,
      kind: note.kind,
      text: note.text,
      trigger: session.triggers.get(note.triggerId)?.key ?? '',
      characters: note.characterIds.flatMap(id => session.characters.get(id)?.name ?? []),
      status: note.status === 'pending' ? 'waiting' : note.status === 'done' ? 'taken' : reason === undefined ? 'lapsed' : 'withdrawn',
      ...(reason === undefined ? {} : { reason }),
    }
  })
}
