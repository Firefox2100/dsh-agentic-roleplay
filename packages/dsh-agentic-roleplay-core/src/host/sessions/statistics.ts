import { existsSync } from 'node:fs'
import { isSessionId, sessionDatabase, sessionFolder, type RoleplayState } from '@dsh-agentic-roleplay/state'
import type { SpeakingShare, StoryStatistics } from '../../shared/statistics.ts'
import { pathTo, type Timeline } from '../../shared/timeline.ts'
import { totalTokens, type TurnUsage } from '../../shared/usage.ts'
import { readTimeline } from '../timeline/file.ts'
import { SessionNotFoundError } from './errors.ts'
import { readUsage } from './usage.ts'

const CJK = /[　-鿿가-힯]/gu

/** How long a text is: its words, and each character of a script that is written without spaces. */
export function lengthOf(text: string): number {
  const wide = text.match(CJK)?.length ?? 0
  return wide + (text.replace(CJK, ' ').match(/[\p{L}\p{N}]+/gu)?.length ?? 0)
}

/** Voices of the delivered turns on the way the story went: who spoke how often and how much, and what the narration came to. */
export function speakingOf(timeline: Pick<Timeline, 'nodes' | 'head'>): { speaking: SpeakingShare[]; narration: StoryStatistics['narration'] } {
  const voices = new Map<string, SpeakingShare>()
  const narration = { passages: 0, length: 0 }
  for (const node of pathTo(timeline, timeline.head)) {
    for (const segment of node.output?.segments ?? []) {
      if (segment.type === 'narration') { narration.passages += 1; narration.length += lengthOf(segment.text); continue }
      const voice = voices.get(segment.character) ?? { name: segment.name, lines: 0, length: 0 }
      voice.lines += 1
      voice.length += lengthOf(segment.text)
      voices.set(segment.character, voice)
    }
  }
  return { speaking: [...voices.values()].sort((a, b) => b.length - a.length), narration }
}

/** How the story branched: turns played again from one state, and turns that were played and are not on the way the story went. */
export function branchesOf(timeline: Pick<Timeline, 'nodes' | 'head'>): StoryStatistics['branches'] {
  const onPath = new Set(pathTo(timeline, timeline.head).map(node => node.id))
  const parents = new Map<string | null, number>()
  for (const node of timeline.nodes) parents.set(node.parent, (parents.get(node.parent) ?? 0) + 1)
  return { branchPoints: [...parents.values()].filter(count => count > 1).length, setAside: timeline.nodes.filter(node => !onPath.has(node.id)).length }
}

export interface StatisticsDeps {
  state: Pick<RoleplayState, 'openSession'>
  sessionsDir: () => string
}

/**
 * The shape of a played story: its length in turns, real and story time, scenes, who spoke how much, open threads, relationships that changed, branches, and what the models used.
 * @throws {SessionNotFoundError} when the id names no session.
 */
export function statisticsOfSession(deps: StatisticsDeps, id: string): StoryStatistics {
  const directory = deps.sessionsDir()
  if (!isSessionId(id) || !existsSync(sessionDatabase(directory, id))) throw new SessionNotFoundError(`no session "${id}"`)
  const story = deps.state.openSession(directory, id)
  const metadata = story.metadata.get()
  const timeline = readTimeline(sessionFolder(directory, id))
  const usage: TurnUsage[] = readUsage(story)
  const log = story.clock.log()
  const first = log[0]
  const now = story.clock.get()?.now
  const places = story.events.list().map(event => event.locationId).filter(place => place !== undefined)
  const threads = story.threads.list()
  const relationships = story.relationships.list()
  return {
    turns: pathTo(timeline, timeline.head).length,
    realTime: { createdAt: metadata.createdAt, ...metadata.lastPlayedAt === undefined ? {} : { lastPlayedAt: metadata.lastPlayedAt }, waitedMs: usage.reduce((sum, entry) => sum + (entry.masterMs ?? 0), 0) },
    storyTime: { ...first === undefined ? {} : { start: new Date(first.to).toISOString() }, ...now === undefined ? {} : { now: new Date(now).toISOString() }, ...first === undefined || now === undefined ? {} : { elapsedSeconds: Math.max(0, Math.round((now - first.to) / 1000)) } },
    scenes: places.filter((place, index) => index === 0 || place !== places[index - 1]).length,
    ...speakingOf(timeline),
    threads: { open: threads.filter(thread => thread.status === 'open').length, resolved: threads.filter(thread => thread.status !== 'open').length },
    relationships: { total: relationships.length, changed: relationships.filter(relation => relation.updatedTurn > 0).length },
    branches: branchesOf(timeline),
    usage: { runs: usage.reduce((sum, entry) => sum + entry.runs, 0), masterTokens: usage.reduce((sum, entry) => sum + totalTokens(entry.master), 0), helperTokens: usage.reduce((sum, entry) => sum + totalTokens(entry.helpers), 0) },
  }
}
