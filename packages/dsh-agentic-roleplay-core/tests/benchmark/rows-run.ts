import { reportScores } from './langfuse-scores.ts'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { NarrationSegment } from '../../src/shared/narration.ts'
import { chatLanguage, evaluate, held, worldOfRow, type BenchData, type Observation, type Row, type Script, type Verdict } from './framework/index.ts'
import type { TimelineView } from '../../src/shared/timeline.ts'
import { liveDecisionService, newCounters } from './live.ts'
import { judgeVoice, sheetsOf } from './voice.ts'
import { writeFiles } from './write.ts'
import type { Trace } from './trace.ts'
import { collectHelpers, findSessionLog, helperTotals, readLog, type HelperRun } from './helper-logs.ts'

/** A running DSH with the roleplay plugin on a throwaway root: the rows are played in it as real stories, so what is measured is the whole product, models included. */
export class StoryRig {
  private cookie = ''

  constructor(private readonly url: string, readonly root: string) {}

  async login(): Promise<void> {
    const response = await fetch(this.url, { redirect: 'manual' })
    this.cookie = (response.headers.getSetCookie?.() ?? []).map(entry => entry.split(';')[0]).join('; ')
    if (this.cookie === '') throw new Error('the DSH gave no session cookie: is the token in BENCH_URL current?')
  }

  async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${new URL(this.url).origin}/roleplay-api${path}`, { ...init, headers: { ...init.headers as Record<string, string>, cookie: this.cookie, 'content-type': 'application/json' } })
    const text = await response.text()
    if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} answered ${response.status}: ${text.slice(0, 300)}`)
    return (text === '' ? undefined : JSON.parse(text)) as T
  }

  async turns(id: string): Promise<number> {
    const { sessions } = await this.api<{ sessions: { id: string; turns: number }[] }>('/sessions')
    const found = sessions.find(session => session.id === id)
    if (found === undefined) throw new Error(`no session ${id}`)
    return found.turns
  }
}

/** A hash of everything a row was made from, so a result is not compared with one of an edited world without saying so. */
export function dataHash(data: BenchData, row: Row): string {
  const composed = worldOfRow(data, row)
  const script = data.scripts.find(entry => entry.id === row.script)
  return createHash('sha256').update(JSON.stringify([row, script, [...composed.files]])).digest('hex').slice(0, 12)
}

export interface RowRun {
  row: string
  language: string
  run: number
  data: string
  verdicts: Verdict[]
  /** The share of judged expectations that held; `undefined` when none could be judged. */
  score: number | undefined
  turns: { say: string; seconds: number; segments: NarrationSegment[] }[]
  failure?: string | undefined
  /** For a row with a planted fault: whether the benchmark saw it (`caught`), or the product kept it out of the story (`defended`). */
  planted?: { what: string; outcome: 'caught' | 'defended' } | undefined
  /** What the helpers of the story (characters, keeper, authors, suggester ...) added up to; each one's whole run is in the trace. */
  helpers?: ReturnType<typeof helperTotals> | undefined
  seconds: number
  trace?: string | undefined
}

interface Delivered { opening?: NarrationSegment[]; turns: { turn: number; output?: { segments: NarrationSegment[]; ooc?: { legal: boolean; note?: string; question?: boolean } } }[] }
interface StatusGroup { subject: string; key?: string; name?: string; values: { name: string; value: string }[] }

/** The largest file whose text is read back for the expectations. */
const MAX_FILE_TEXT = 200 * 1024
/** How long the background helpers of a story get after its last turn before their logs are read and the story is removed. */
const SETTLE_MS = Number(process.env['BENCH_SETTLE_SECONDS'] ?? '45') * 1000
const TURN_LIMIT_MS = Number(process.env['BENCH_TURN_MINUTES'] ?? '20') * 60_000
const POLL_MS = 3000
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** Where DSH keeps the chat logs, to keep the game master's own record beside the trace. */
const sessionsFolder = (): string => process.env['BENCH_DSH_SESSIONS'] ?? join(homedir(), '.dsh', 'sessions')

function keepChatLog(chat: string, to: string): string | undefined {
  const base = sessionsFolder()
  if (!existsSync(base)) return undefined
  for (const folder of readdirSync(base)) {
    const file = join(base, folder, chat, 'session.v4.jsonl.zstd')
    if (existsSync(file)) { mkdirSync(dirname(to), { recursive: true }); copyFileSync(file, to); return to }
  }
  return undefined
}

/** The settings a row's story starts with: the row's own over the defaults, and the language of the instructions is the row's, as the start dialog sets it from the interface. */
export function settingsOf(row: Row): Record<string, unknown> {
  const given = row.settings ?? {}
  const prompts = (given['prompts'] ?? {}) as Record<string, unknown>
  return { ...given, prompts: { language: chatLanguage(row), ...prompts } }
}

/** What the player may read of the story's values: each value with who or what it belongs to. */
async function valuesOf(rig: StoryRig, session: string): Promise<NonNullable<Observation['values']>> {
  const answer = await rig.api<StatusGroup[] | { status?: StatusGroup[]; entries?: StatusGroup[] }>(`/sessions/reference?id=${session}&section=status`)
  const groups = Array.isArray(answer) ? answer : answer.status ?? answer.entries ?? []
  return groups.flatMap(group => group.values.map(value => ({ of: [group.subject, group.key, group.name].filter((part): part is string => part !== undefined), name: value.name, value: value.value })))
}

interface World { characters: { key: string; name: string; control: string; place?: { key: string }; state?: { activity?: string } }[]; things: { key: string; holder: string }[]; triggers?: { key: string; status?: string; fireCount?: number }[] }

/** How many of each wanted character's lines the decision model finds in its voice, when the script asks and `BENCH_DECISION_URL` names a decision model; otherwise nothing is judged. */
async function voicesOf(script: Script, files: ReadonlyMap<string, unknown>, observation: Observation, trace: Trace): Promise<Observation['voice']> {
  const url = process.env['BENCH_DECISION_URL']
  const wanted = [...new Set([...script.expect, ...script.turns.flatMap(turn => ('expect' in turn ? turn.expect : []))].flatMap(expectation => (expectation.type === 'speaks-in-voice' ? [expectation.character] : [])))]
  if (url === undefined || wanted.length === 0) return undefined
  const service = liveDecisionService({ url, model: process.env['BENCH_DECISION_MODEL'] ?? 'kev-9b', mode: 'decision', confidence: 0.7 }, newCounters(trace))
  const sheets = sheetsOf(files)
  const judged: NonNullable<Observation['voice']> = []
  for (const character of wanted) {
    const sheet = sheets.get(character)
    if (sheet === undefined) continue
    const lines = observation.turns.flatMap(turn => turn.segments).flatMap(segment => (segment.type === 'utterance' && segment.character === character ? [segment.text] : []))
    try { judged.push({ character, ...await judgeVoice(service, sheet, lines, observation.language) }) } catch (error) { trace.note(`the voice of ${character} could not be judged: ${error instanceof Error ? error.message : String(error)}`) }
  }
  return judged
}

/**
 * Plays one row as a story: the composed world is put in the rig's root, started with the row's player and settings, the script's steps are taken one at a time and each waited for,
 * what the story delivered and holds is read back, every expectation is judged and written to the trace, and the story and the world are removed again.
 */
export async function playRow(rig: StoryRig, data: BenchData, row: Row, script: Script, trace: Trace, keepLogTo?: string): Promise<RowRun> {
  const began = Date.now()
  const composed = worldOfRow(data, row)
  if (composed.problems.length > 0) throw new Error(composed.problems.join('; '))
  const worldId = `bench-${row.id}`
  const folder = join(rig.root, 'worlds', worldId)
  const world = composed.files.get('world.json') as Record<string, unknown>
  composed.files.set('world.json', { ...world, id: worldId, name: `${String(world['name'])} (${row.id})` })
  await rm(folder, { recursive: true, force: true })
  await writeFiles(folder, composed.files)
  // folders for the story's file tools live beside the rig's root, never inside it; `outside` is one the story is not given
  const scratch = join(dirname(rig.root), 'bench-folders', row.id)
  const places: Record<string, string> = { workspace: join(rig.root, 'workspace'), outside: join(scratch, 'outside'), ...Object.fromEntries((row.folders ?? []).map(entry => [entry.name, join(scratch, entry.name)])) }
  await rm(scratch, { recursive: true, force: true })
  for (const name of Object.keys(places)) if (name !== 'workspace') await mkdir(places[name]!, { recursive: true })
  const named = [...script.expect, ...script.turns.flatMap(turn => turn.expect)].flatMap(expectation => (expectation.type === 'file-exists' || expectation.type === 'file-lacks') && expectation.in === 'workspace' ? [expectation.name] : [])
  for (const file of named) await rm(join(places['workspace']!, file), { force: true })
  for (const file of row.files ?? []) { await mkdir(places[file.in]!, { recursive: true }); await writeFile(join(places[file.in]!, file.name), file.text); if (file.in === 'workspace') named.push(file.name) }
  const said = (text: string): string => text.replace(/\{workspace\}/g, places['workspace']!).replace(/\{outside\}/g, places['outside']!).replace(/\{folder:([^}]+)\}/g, (_match, name: string) => places[name] ?? '')
  trace.state('row', { row, script, settings: settingsOf(row), files: [...composed.files.keys()], places })
  let session: string | undefined
  const played: RowRun['turns'] = []
  const steps: { segments: NarrationSegment[]; ooc?: { legal: boolean; note?: string; question?: boolean }; scene?: string[] }[] = []
  let failure: string | undefined
  let initialValues: Observation['initialValues']
  let castAtStart: number | undefined
  const nameOf = new Map<string, string>()
  try {
    await rig.api('/worlds/refresh', { method: 'POST' })
    const started = await rig.api<{ id: string; chatSessionId: string }>('/sessions', { method: 'POST', body: JSON.stringify({ worldId, name: row.id, playerCharacterId: row.cast.player, settings: settingsOf(row), ...row.answers === undefined ? {} : { answers: row.answers } }) })
    session = started.id
    trace.note(`started ${started.id}`)
    initialValues = await valuesOf(rig, session).catch(() => undefined)
    if ((row.folders ?? []).length > 0) await rig.api(`/sessions/folders?id=${session}`, { method: 'PUT', body: JSON.stringify({ folders: row.folders!.map(entry => ({ path: places[entry.name], access: entry.access })) }) })
    castAtStart = (await rig.api<World>(`/sessions/world?id=${session}`).catch(() => undefined))?.characters.length
    trace.state('values at the start', initialValues)
    let last = ''
    for (const [index, turn] of script.turns.entries()) {
      const sent = Date.now()
      if (turn.action === 'wait') {
        trace.event('request', { service: 'story', action: 'wait', minutes: turn.minutes })
        await sleep((turn.minutes ?? 1) * 60_000)
        steps.push({ segments: [] })
        played.push({ say: `(wait ${turn.minutes} minutes)`, seconds: (turn.minutes ?? 1) * 60, segments: [] })
        continue
      }
      if (turn.action === 'rewind') {
        const view = await rig.api<TimelineView>(`/sessions/timeline?id=${session}`)
        const target = turn.to === 0 ? 'start' : view.path[(turn.to ?? 1) - 1]?.id
        if (target === undefined) throw new Error(`there is no turn ${turn.to} to take the story back to`)
        trace.event('request', { service: 'story', action: 'rewind', to: turn.to })
        await rig.api(`/sessions/timeline/move?id=${session}&to=${encodeURIComponent(target)}`, { method: 'POST' })
        steps.push({ segments: [] })
        played.push({ say: `(rewind to ${turn.to})`, seconds: Math.round((Date.now() - sent) / 1000), segments: [] })
        continue
      }
      let say = said(turn.say ?? '')
      if (turn.action === 'regenerate') {
        const view = await rig.api<TimelineView>(`/sessions/timeline?id=${session}`)
        const parent = view.path.at(-2)?.id ?? 'start'
        say = last
        trace.event('request', { service: 'story', action: 'regenerate', to: parent })
        await rig.api(`/sessions/timeline/move?id=${session}&to=${encodeURIComponent(parent)}`, { method: 'POST' })
      }
      last = say
      const before = await rig.turns(session)
      trace.event('request', { service: 'story', say, step: index + 1 })
      await rig.api('/sessions/message', { method: 'POST', body: JSON.stringify({ id: session, text: say }) })
      while (await rig.turns(session) === before) {
        if (Date.now() - sent > TURN_LIMIT_MS) throw new Error(`no turn finished within ${TURN_LIMIT_MS / 60_000} minutes`)
        await sleep(POLL_MS)
      }
      const delivered = await rig.api<Delivered>(`/sessions/export?id=${session}&format=json&annotated=1`)
      const segments = delivered.turns.at(-1)?.output?.segments ?? []
      const ooc = delivered.turns.at(-1)?.output?.ooc
      trace.event('response', { service: 'story', ms: Date.now() - sent, raw: segments })
      // the sections of the scene the game master was given in this turn, from the program's own trace of it
      const scene = await rig.api<{ trace?: { turn: number; scene?: { id: string }[] }[] }>(`/sessions/settings?id=${session}`).then(read => [...(read.trace ?? [])].sort((a, b) => a.turn - b.turn).at(-1)?.scene?.map(part => part.id), () => undefined)
      steps.push({ segments, ...(ooc === undefined ? {} : { ooc }), ...(scene === undefined ? {} : { scene }) })
      played.push({ say, seconds: Math.round((Date.now() - sent) / 1000), segments })
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
    trace.event('error', { service: 'story', message: failure })
  }
  let observation: Observation = { language: chatLanguage(row), player: row.cast.player, turns: [], played: steps }
  if (session !== undefined) {
    try {
      const shown = await rig.api<Delivered>(`/sessions/export?id=${session}&format=json&annotated=1`)
      observation = { ...observation, turns: shown.turns.filter(turn => turn.output !== undefined).map(turn => ({ segments: turn.output!.segments, ...(turn.output!.ooc === undefined ? {} : { ooc: turn.output!.ooc }) })), ...shown.opening === undefined ? {} : { opening: shown.opening.map(segment => segment.text).join('\n') } }
    } catch (error) { trace.note(`the story could not be read back: ${error instanceof Error ? error.message : String(error)}`) }
    try {
      const state = await rig.api<World>(`/sessions/world?id=${session}`)
      for (const character of state.characters) nameOf.set(character.name, character.key)
      observation = {
        ...observation,
        characters: state.characters.map(character => ({ key: character.key, name: character.name, placed: character.place !== undefined, ...character.state?.activity === undefined ? {} : { activity: character.state.activity }, ...character.place === undefined ? {} : { place: character.place.key } })),
        ...castAtStart === undefined ? {} : { castAtStart },
        things: state.things.map(thing => ({ key: thing.key, holder: nameOf.get(thing.holder) ?? thing.holder })),
        ...state.triggers === undefined ? {} : { triggers: state.triggers.map(trigger => ({ key: trigger.key, fired: trigger.status === 'fired' || (trigger.fireCount ?? 0) > 0 })) },
        places: row.features.includes('places'),
      }
      trace.state('story', { characters: state.characters.map(character => ({ key: character.key, place: character.place?.key })), things: state.things.map(thing => ({ key: thing.key, holder: thing.holder })), triggers: state.triggers?.map(trigger => ({ key: trigger.key, status: trigger.status, fireCount: trigger.fireCount })) })
    } catch (error) { trace.note(`the story's records could not be read: ${error instanceof Error ? error.message : String(error)}`) }
    try {
      const read = await rig.api<{ settings: Record<string, unknown> }>(`/sessions/settings?id=${session}`)
      observation = { ...observation, settings: read.settings }
    } catch (error) { trace.note(`the settings could not be read: ${error instanceof Error ? error.message : String(error)}`) }
    try {
      const status = await rig.api<{ active?: string; problems: { file?: string; message: string }[] }>(`/sessions/interface/status?id=${session}`)
      observation = { ...observation, pack: { ...status.active === undefined ? {} : { active: status.active }, problems: status.problems.map(problem => problem.message) } }
    } catch (error) { trace.note(`the interface pack could not be read: ${error instanceof Error ? error.message : String(error)}`) }
    try {
      const notes = await rig.api<{ kind: string; lines: string[] }[]>(`/sessions/notes?id=${session}`)
      observation = { ...observation, notes }
      trace.state('notes', notes)
    } catch (error) { trace.note(`the notes could not be read: ${error instanceof Error ? error.message : String(error)}`) }
    try {
      const files: Record<string, string[]> = {}
      const fileTexts: Record<string, Record<string, string>> = {}
      for (const [name, path] of Object.entries(places)) {
        files[name] = await readdir(path).catch(() => [])
        fileTexts[name] = {}
        for (const file of files[name]!) {
          const info = await stat(join(path, file)).catch(() => undefined)
          if (info?.isFile() === true && info.size <= MAX_FILE_TEXT) fileTexts[name]![file] = await readFile(join(path, file), 'utf8').catch(() => '')
        }
      }
      observation = { ...observation, files, fileTexts }
      trace.state('files', files)
    } catch (error) { trace.note(`the folders could not be read: ${error instanceof Error ? error.message : String(error)}`) }
    try {
      const values = await valuesOf(rig, session)
      observation = { ...observation, values, ...initialValues === undefined ? {} : { initialValues } }
      trace.state('values at the end', values)
    } catch (error) { trace.note(`the story's values could not be read: ${error instanceof Error ? error.message : String(error)}`) }
  }
  const voice = await voicesOf(script, composed.files, observation, trace)
  if (voice !== undefined) observation = { ...observation, voice }
  let helpers: HelperRun[] | undefined
  const verdicts = evaluate(script, observation)
  const describe = (expectation: Verdict['expectation']): string => Object.entries(expectation).filter(([key]) => key !== 'type').map(([, value]) => String(value)).join(' ')
  for (const verdict of verdicts) trace.expect(`${verdict.where}: ${verdict.expectation.type} ${describe(verdict.expectation)}`.trim(), verdict.held ?? false, verdict.held === undefined ? 'not judged' : verdict.found)
  if (session !== undefined) {
    // what runs in the background after the last turn (suggestions, the keeper, tracked values) gets a moment to finish, so that its logs are whole
    await sleep(SETTLE_MS)
    const scored = await reportScores(session, row.id, verdicts).catch((error: unknown) => `the scores could not be sent: ${error instanceof Error ? error.message : String(error)}`)
    if (scored !== undefined) trace.note(scored)
    if (keepLogTo !== undefined) { const kept = keepChatLog(`session-${session}`, keepLogTo); if (kept !== undefined) trace.note(`the game master's log is kept at ${kept}`) }
    try {
      const chat = findSessionLog(sessionsFolder(), `session-${session}`)
      if (chat !== undefined) {
        helpers = collectHelpers(readLog(chat), sessionsFolder(), keepLogTo === undefined ? undefined : keepLogTo.replace(/\.chat\.jsonl\.zstd$/, '.helpers'))
        for (const run of helpers) trace.event('helper', { ...run })
      }
    } catch (error) { trace.note(`the helpers' logs could not be read: ${error instanceof Error ? error.message : String(error)}`) }
    await rig.api(`/sessions/item?id=${session}`, { method: 'DELETE' }).catch((error: unknown) => { trace.note(`the story could not be deleted: ${error instanceof Error ? error.message : String(error)}`) })
  }
  await rm(folder, { recursive: true, force: true })
  await rm(scratch, { recursive: true, force: true })
  for (const file of named) await rm(join(places['workspace']!, file), { force: true })
  await rig.api('/worlds/refresh', { method: 'POST' }).catch(() => undefined)
  const planted = row.plant === undefined ? undefined : { what: row.plant.what, outcome: verdicts.some(verdict => verdict.held === false && row.plant!.caught.includes(verdict.expectation.type)) ? 'caught' as const : 'defended' as const }
  return { row: row.id, language: row.language, run: 0, data: dataHash(data, row), verdicts, score: held(verdicts), turns: played, failure, planted, ...helpers === undefined ? {} : { helpers: helperTotals(helpers) }, seconds: Math.round((Date.now() - began) / 1000), trace: trace.file }
}
