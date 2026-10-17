import type { Boundaries, CastMember, CharacterRequest, TurnStore } from './boundaries.ts'
import type { CharacterFailure, CharacterReport } from './protocol.ts'
import type { Attempt, TurnState } from './turn-state.ts'
import type { RunCharacter, TurnOwner } from './turn-engine.ts'
import { cuesOf, knownRelationships, reactions } from './turn-rules.ts'

/** What asking the characters needs from the engine that runs the turn. */
export interface AskDeps {
  boundaries: Boundaries
  /** The chat's store, when it has one. */
  store: TurnStore | undefined
  storeOf: (owner: TurnOwner) => TurnStore
  problem: (message: string) => void
}

/** Every character acts at the same time; one that fails or answers badly is reported, not fatal. */
export async function askCharacters(deps: AskDeps, owner: TurnOwner, number: 1 | 2, keys: readonly string[], cast: readonly CastMember[], state: TurnState, run: RunCharacter, signal: AbortSignal, away = false): Promise<Attempt> {
  const { store, boundaries } = deps
  const { outputValidator } = boundaries
  const reaction = number === 2 ? reactions(state) : undefined
  // One vector of the moment serves every character; the search of what each remembers is its own.
  const queryVector = number === 1 && store !== undefined ? await store.queryVector(state.situation, signal) : undefined
  const time = store?.time(owner.turn)
  const answers = await Promise.all(keys.map(async (key): Promise<CharacterReport | CharacterFailure> => {
    const member = cast.find(candidate => candidate.key === key)
    if (member === undefined) return { character: key, name: key, reason: 'no such character' }
    const previous = number === 2 ? state.first?.reports.find(report => report.character === key) : undefined
    const memories = number === 1 && store !== undefined
      ? await boundaries.recaller.recall({ member, situation: state.situation, turn: owner.turn, policy: store.settings().memory, ...(store.settings().diagnostics.keepRuns ? { explain: true } : {}), ...(queryVector === undefined ? {} : { queryVector }) }, store.story, signal)
      : state.recalled.get(key) ?? []
    if (number === 1 && memories.length > 0) state.recalled.set(key, memories)
    const place = member.place === undefined ? undefined : store?.place(member.place.location.id)
    const relationships = store === undefined ? [] : knownRelationships(member, place === undefined ? cast : place.here, state.situation, cast, store)
    const carrying = store === undefined ? [] : store.carried(member.character.id)
    const knowledge = store?.knowledge(member.character.id, owner.turn, (place === undefined ? cast : place.here).map(entry => entry.character.id))
    const affiliations = store?.affiliations(member.character.id) ?? []
    const agenda = store?.agenda(owner.turn, member.character.id)
    const cues = cuesOf(state, key, member, store, number)
    const upcoming = store?.upcomingFor(member.character.id, owner.turn) ?? []
    const tracked = store?.trackedFor(member.character.id, (place === undefined ? cast : place.here).map(entry => entry.character.id))
    const request: CharacterRequest = {
      member, cast, situation: state.situation, attempt: number, language: store?.settings().prompts.language ?? 'en', turn: owner.turn, ...(away ? { away: true as const } : {}), lookup: store?.settings().memory.lookup ?? false, text: (id, variables) => deps.storeOf(owner).text(id, variables),
      ...(time === undefined ? {} : { time }),
      ...(agenda === undefined ? {} : { agenda }),
      ...(cues.length === 0 ? {} : { cues }),
      ...(upcoming.length === 0 ? {} : { upcoming }),
      ...(tracked === undefined || (tracked.self === '' && tracked.others.length === 0) ? {} : { tracked }),
      ...(place === undefined ? {} : { place }),
      ...(relationships.length === 0 ? {} : { relationships }),
      ...(carrying.length === 0 ? {} : { carrying }),
      ...(knowledge === undefined ? {} : { knowledge }),
      ...(affiliations.length === 0 ? {} : { affiliations }),
      ...(memories.length === 0 ? {} : { memories }),
      ...(state.history.length === 0 ? {} : { earlier: [...state.history] }),
      ...(reaction === undefined ? {} : { reaction }),
      ...(previous === undefined ? {} : { previous: { intent: previous.intent, commitment: previous.commitment } }),
    }
    try {
      const action = await run(request, signal)
      const verdict = outputValidator.validate(action, request)
      if (!verdict.ok) return { character: key, name: member.character.name, reason: verdict.reason }
      return { character: key, name: member.character.name, ...action }
    } catch (error) {
      if (signal.aborted) throw error
      const reason = error instanceof Error ? error.message : String(error)
      deps.problem(`${member.character.name} could not act: ${reason}`)
      return { character: key, name: member.character.name, reason, technical: true }
    }
  }))
  return {
    reports: answers.filter((answer): answer is CharacterReport => 'intent' in answer),
    failures: answers.filter((answer): answer is CharacterFailure => 'reason' in answer),
  }
}
