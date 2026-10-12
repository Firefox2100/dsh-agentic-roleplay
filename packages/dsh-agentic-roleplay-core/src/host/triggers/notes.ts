import { announcements, describeDuration, describeInstant, inAudience, locationKey, type Announcement, type Session } from '@dsh-agentic-roleplay/state'
import type { ChatSettings } from '../../shared/settings.ts'
import type { TriggerReport, TurnStore } from '../orchestration/boundaries.ts'

type TriggerSession = Pick<Session, 'triggers' | 'characters' | 'locations' | 'placements' | 'runTriggers' | 'lapseNotes' | 'transaction'>

/** Fires the triggers whose conditions just came true, and says what each did in words. A trigger that could not be applied is reported and given up. */
export function fireTriggers(session: TriggerSession, input: { settings: ChatSettings; turn: number; round: number; now: number; zone: string; problem: (message: string) => void }): TriggerReport {
  const { settings, turn, round, now, zone, problem } = input
  if (!settings.triggers.enabled) return { fired: [] }
  const before = Math.max(0, ...session.triggers.notes().map(note => note.id))
  const run = session.runTriggers({ turn, round, now, zone, maxFires: settings.triggers.maxFires })
  for (const failure of run.failed) problem(`the trigger "${failure.trigger.key}" could not fire and is given up: ${failure.problem}`)
  const names = new Map(session.characters.list().map(character => [character.id, character.name]))
  const fresh = session.triggers.notes({ status: 'pending' }).filter(note => note.id > before)
  return {
    fired: run.fired.map(fired => ({
      name: fired.trigger.name,
      events: fired.events,
      cues: fresh.filter(note => note.triggerId === fired.trigger.id && note.kind === 'cue').map(note => ({ names: note.characterIds.flatMap(id => names.get(id) ?? []), text: note.text })),
      beats: fresh.filter(note => note.triggerId === fired.trigger.id && note.kind === 'beat').map(note => ({ id: note.id, text: note.text })),
    })),
  }
}

/** The beats still to weave in, the cues of a character, and what is done with them. */
/** When something is to happen, as it is told: the date and how far off it is. */
function whenText(at: number | undefined, clock: { now: number; zone: string }): string | undefined {
  if (at === undefined) return undefined
  return `${describeInstant(at, clock.zone)}${at > clock.now ? `, in ${describeDuration(at - clock.now)}` : ''}`
}

function whoKnows(session: TriggerSession, announcement: Announcement): string {
  const { audience } = announcement
  if (audience === 'everyone') return 'everyone'
  if ('place' in audience) return `whoever is at ${session.locations.list().find(place => locationKey(place) === audience.place)?.name ?? audience.place}`
  return audience.characters.map(key => session.characters.list().find(entry => (entry.sourceId ?? String(entry.id)) === key)?.name ?? key).join(', ')
}

/** At most this many announcements are told to one character at once: soonest first. */
const MAX_UPCOMING_FOR_CHARACTER = 3

export function noteStore(session: TriggerSession, settings: () => ChatSettings, clock: (turn: number) => { now: number; zone: string }): Pick<TurnStore, 'pendingBeats' | 'resolveBeats' | 'cuesFor' | 'doneCues' | 'lapseNotes' | 'upcoming' | 'upcomingFor'> {
  return {
    upcoming: (turn) => {
      const now = clock(turn)
      return announcements(session, now).map((entry) => { const when = whenText(entry.at, now); return { text: entry.text, who: whoKnows(session, entry), ...(when === undefined ? {} : { when }) } })
    },
    upcomingFor: (characterId, turn) => {
      const now = clock(turn)
      return announcements(session, now).filter(entry => inAudience(session, entry.audience, characterId)).slice(0, MAX_UPCOMING_FOR_CHARACTER).map((entry) => { const when = whenText(entry.at, now); return { text: entry.text, ...(when === undefined ? {} : { when }) } })
    },
    pendingBeats: () => session.triggers.notes({ status: 'pending', kind: 'beat' }).map(note => ({ id: note.id, text: note.text })),
    resolveBeats: (ids) => {
      const pending = new Set(session.triggers.notes({ status: 'pending', kind: 'beat' }).map(note => note.id))
      const unknown = ids.filter(id => !pending.has(id))
      if (unknown.length > 0) throw new Error(`${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not ${unknown.length === 1 ? 'a beat' : 'beats'} still to weave in`)
      session.transaction(() => { for (const id of ids) session.triggers.resolveNote(id, 'done') })
    },
    cuesFor: characterId => session.triggers.notes({ status: 'pending', kind: 'cue' }).filter(note => note.characterIds.includes(characterId)).map(note => ({ id: note.id, text: note.text })),
    doneCues: (ids) => { session.transaction(() => { for (const id of ids) session.triggers.resolveNote(id, 'done') }) },
    lapseNotes: (turn) => {
      const { triggers } = settings()
      session.lapseNotes(turn, { beats: triggers.beatTurns, cues: triggers.cueTurns })
    },
  }
}
