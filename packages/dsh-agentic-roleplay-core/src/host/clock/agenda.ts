import { ENGAGEMENT_GRACE, MINUTE, agendaAt, nextOccurrence, occurrenceAt, type Session } from 'dsh-roleplay-state'

type AgendaSession = Pick<Session, 'characters' | 'characterStates' | 'placements' | 'locations' | 'routines' | 'engagements' | 'intents' | 'metadata' | 'move' | 'transaction' | 'consolidation'>

const CURSOR = 'agenda.cursor'
const ASKED = 'agenda.asked'
/** At most this many characters are asked to be given a day at a time, so that it never floods the world author. */
const MAX_ASKED = 3

/** A character that went somewhere because its day says so. */
export interface RoutineMove {
  character: string
  name: string
  /** The name of the place it is now at. */
  to: string
  activity: string
}

/** How far ahead the characters are told about what comes next in their day. */
const NEXT_HORIZON = 4 * 60 * MINUTE
/** What a character is shown of its own agenda at most. */
const SHOWN_ENGAGEMENTS = 4
const SHOWN_GOALS = 3

/** A character's own agenda as it is told to it. */
export interface AgendaView {
  zone: string
  /** What its day has it doing now, and until when. */
  now?: { activity: string; place?: string; until: number; interruptible: boolean }
  /** What its day has it doing next. */
  next?: { activity: string; place?: string; at: number }
  engagements: { title: string; at: number; place?: string; with: string[]; overdue: boolean }[]
  goals: { name: string; type: string; description: string; plan: string[]; deadline?: number; overdue: boolean }[]
}

const keyOfCharacter = (character: { id: number; sourceId?: string }): string => character.sourceId ?? String(character.id)

/**
 * Bring the days of the characters up to the story's time: those who are not in the player's scene go where their
 * routine has them now, and take up what it has them doing, when the window they are in has changed since the last
 * time. Characters in the scene stay: the game master is told what their day expects of them instead. It costs
 * nothing but a look at each character's windows, however long the story was skipped.
 */
export function catchUpRoutines(session: AgendaSession, zone: string, now: number, turn: number, ask: boolean): RoutineMove[] {
  return session.transaction(() => {
    const cursor = typeof session.metadata.getValue(CURSOR) === 'number' ? session.metadata.getValue(CURSOR) as number : undefined
    if (cursor === now) return []
    const player = session.characters.list().find(character => character.control === 'player')
    const playerPlace = player === undefined ? undefined : session.placements.get('character', player.id)?.locationId
    const moves: RoutineMove[] = []
    const alreadyAsked = new Set(Array.isArray(session.metadata.getValue(ASKED)) ? session.metadata.getValue(ASKED) as number[] : [])
    const asked: number[] = []
    for (const character of session.characters.list()) {
      if (character.control === 'player') continue
      const characterId = character.id
      const window = session.routines.list(characterId)
      const here = session.placements.get('character', characterId)
      const away = playerPlace === undefined || here?.locationId !== playerPlace
      // Someone who matters and has been away while time passed is given a day by the world author, once.
      if (window.length === 0) {
        if (ask && playerPlace !== undefined && away && cursor !== undefined && asked.length < MAX_ASKED && character.kind === 'person' && character.tier !== 'background' && !alreadyAsked.has(characterId)) {
          session.consolidation.enqueue({ kind: 'character', subjectId: characterId, note: 'has no routine: give it a day (routines), as far as its role and the story imply', turn })
          asked.push(characterId)
        }
        continue
      }
      if (!away) continue
      const current = occurrenceAt(window, now, zone)
      if (current === undefined) continue
      const before = cursor === undefined ? undefined : occurrenceAt(window, cursor, zone)
      if (before !== undefined && before.window.id === current.window.id && before.startsAt === current.startsAt) continue
      const target = current.window
      if (target.locationId !== undefined && (here?.locationId !== target.locationId || (target.position !== undefined && here.position !== target.position))) {
        session.move(characterId, { to: target.locationId, ignoreExits: true, ...(target.position === undefined ? {} : { position: target.position }), ...(target.featureKey === undefined ? {} : { featureKey: target.featureKey }) })
        moves.push({ character: keyOfCharacter(character), name: character.name, to: session.locations.get(target.locationId)?.name ?? String(target.locationId), activity: target.activity })
      }
      if (session.characterStates.get(characterId)?.activity !== target.activity) session.characterStates.update(characterId, { activity: target.activity })
    }
    session.metadata.setValue(CURSOR, now)
    if (asked.length > 0) session.metadata.setValue(ASKED, [...alreadyAsked, ...asked])
    return moves
  })
}

/** A character's agenda at an instant, with places by name and others by name. */
export function agendaView(session: AgendaSession, characterId: number, zone: string, now: number): AgendaView {
  const agenda = agendaAt(session, characterId, now, zone, { horizon: NEXT_HORIZON, engagements: SHOWN_ENGAGEMENTS, goals: SHOWN_GOALS })
  const place = (id: number | undefined): string | undefined => (id === undefined ? undefined : session.locations.get(id)?.name)
  const names = (ids: readonly number[]): string[] => ids.filter(id => id !== characterId).map(id => session.characters.get(id)?.name ?? String(id))
  return {
    zone,
    ...(agenda.now === undefined ? {} : { now: { activity: agenda.now.window.activity, ...(place(agenda.now.window.locationId) === undefined ? {} : { place: place(agenda.now.window.locationId)! }), until: agenda.now.endsAt, interruptible: agenda.now.window.interruptible } }),
    ...(agenda.next === undefined ? {} : { next: { activity: agenda.next.window.activity, ...(place(agenda.next.window.locationId) === undefined ? {} : { place: place(agenda.next.window.locationId)! }), at: agenda.next.startsAt } }),
    engagements: agenda.engagements.map(({ engagement, overdue }) => ({ title: engagement.title, at: engagement.at, ...(place(engagement.locationId) === undefined ? {} : { place: place(engagement.locationId)! }), with: names(engagement.participants), overdue })),
    goals: agenda.goals.map(({ intent, deadlineAt, overdue }) => ({ name: intent.name, type: intent.type, description: intent.description, plan: intent.plan.slice(0, 3), ...(deadlineAt === undefined ? {} : { deadline: deadlineAt }), overdue })),
  }
}

/** What the game master is told of the days of the characters at the start of a turn. */
export interface SceneAgenda {
  zone: string
  /** Who went where, by their routines, since the last time. */
  moved: RoutineMove[]
  /** Characters with the player's character whose day expects them elsewhere, or soon will. */
  here: { name: string; note: string }[]
  /** Commitments due soon or overdue, whoever they are of. */
  engagements: { title: string; at: number; place?: string; with: string[]; overdue: boolean }[]
}

/** How soon ahead the game master is told of a window ending or a commitment falling due. */
const SOON = 30 * MINUTE
const MAX_NOTES = 6
/** An engagement that has been overdue for longer than this is not worth the game master's attention every turn. */
const STALE = 24 * 60 * MINUTE

export function sceneAgenda(session: AgendaSession, zone: string, now: number, moved: RoutineMove[]): SceneAgenda {
  const player = session.characters.list().find(character => character.control === 'player')
  const playerPlace = player === undefined ? undefined : session.placements.get('character', player.id)?.locationId
  const withPlayer = new Set(session.characters.list().filter(character => playerPlace !== undefined && session.placements.get('character', character.id)?.locationId === playerPlace && character.control !== 'player').map(character => character.id))
  const here: SceneAgenda['here'] = []
  for (const characterId of withPlayer) {
    const windows = session.routines.list(characterId)
    const current = occurrenceAt(windows, now, zone)
    const upcoming = nextOccurrence(windows, now, zone, SOON)
    const name = session.characters.get(characterId)?.name ?? String(characterId)
    const place = current?.window.locationId === undefined ? undefined : session.locations.get(current.window.locationId)
    if (current !== undefined && current.window.locationId !== undefined && current.window.locationId !== playerPlace) here.push({ name, note: `its day says "${current.window.activity}"${place === undefined ? '' : ` at ${place.name}`} now, yet it is here` })
    else if (current !== undefined && current.endsAt - now <= SOON) here.push({ name, note: `"${current.window.activity}" is due to end soon` })
    else if (current === undefined && upcoming !== undefined) here.push({ name, note: `"${upcoming.window.activity}" begins soon${upcoming.window.locationId === undefined ? '' : ` at ${session.locations.get(upcoming.window.locationId)?.name ?? ''}`}` })
  }
  const engagements = session.engagements.list({ status: 'pending', to: now + SOON })
    .filter(engagement => now - (engagement.until ?? engagement.at) < STALE)
    .slice(0, MAX_NOTES)
    .map(engagement => ({
      title: engagement.title, at: engagement.at,
      ...(engagement.locationId === undefined ? {} : { place: session.locations.get(engagement.locationId)?.name ?? '' }),
      with: engagement.participants.map(id => session.characters.get(id)?.name ?? String(id)),
      overdue: now > (engagement.until ?? engagement.at + ENGAGEMENT_GRACE),
    }))
  return { zone, moved, here: here.slice(0, MAX_NOTES), engagements }
}
