import type { Session } from '@dsh-agentic-roleplay/state'
import { MAX_INTERVENTIONS, type Intervention } from '../../shared/interventions.ts'

type InterventionSession = Pick<Session, 'triggers' | 'characters'>

/** What the story's triggers delivered lately and what became of each, oldest first. */
export function readInterventions(session: InterventionSession): Intervention[] {
  return session.triggers.notes().slice(-MAX_INTERVENTIONS).map((note): Intervention => ({
    turn: note.turn,
    kind: note.kind,
    text: note.text,
    trigger: session.triggers.get(note.triggerId)?.key ?? '',
    characters: note.characterIds.flatMap(id => session.characters.get(id)?.name ?? []),
    status: note.status === 'pending' ? 'waiting' : note.status === 'done' ? 'taken' : 'lapsed',
  }))
}
