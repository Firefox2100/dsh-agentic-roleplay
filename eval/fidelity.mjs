// How faithful a story's memory is to what the game master decided, and where each turn's time went. Read-only and deterministic: no model is called.
// Ground truth is the game master's own structured decisions in DSH's chat log (outcomes of each recorded round, delivered utterances); the memory is the
// session database. It reports what a round decided that no event records (missed), events no decision explains (spurious), events that cover several
// decisions (merged), utterances found in no record, near-duplicate open threads, and tags that only differ in form.
//
//   node eval/fidelity.mjs <session uuid> [--root <roleplay root>] [--sessions <dsh sessions dir>] [--json]
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const OUTPUT = /<roleplay-output>([\s\S]*?)<\/roleplay-output>/
const RECORDED = /^Round (\d+) is recorded \(([^)]*)\)/
const GM_PULLS = /^(list_|get_|search_)/
const words = (text) => new Set(String(text).toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 3))
const overlapShare = (small, large) => (small.size === 0 ? 0 : [...small].filter(word => large.has(word)).length / small.size)
const jaccard = (a, b) => { const union = new Set([...a, ...b]); return union.size === 0 ? 0 : [...a].filter(word => b.has(word)).length / union.size }
const stem = (tag) => tag.toLowerCase().replace(/(ing|ed|es|s)$/u, '')

/** The rounds the game master recorded and the utterances it delivered, from the rows of the chat log, in order. */
export function parseTruth(rows) {
  const calls = new Map()
  const rounds = []
  const utterances = []
  let lastResolve
  for (const row of rows) {
    if (row.type === 'tool/call') {
      calls.set(row.data.callId, row.data)
      if (row.data.name === 'resolve_round') lastResolve = row.data
    } else if (row.type === 'tool/result') {
      const message = row.data.message
      const call = calls.get(message?.toolCallId)
      const text = message?.content?.map(part => part.text ?? '').join('') ?? ''
      if (message?.isError === true) continue
      const recorded = RECORDED.exec(text)
      if (recorded !== null && lastResolve !== undefined) {
        const outcomes = JSON.parse(lastResolve.arguments).outcomes ?? []
        rounds.push({ turn: call?.turn ?? row.data.turn, round: Number(recorded[1]), characters: recorded[2].split(',').map(key => key.trim()).filter(Boolean), outcomes })
      }
      const delivered = OUTPUT.exec(text)
      if (delivered !== null && (call?.name === 'narrate' || call?.name === 'roll_and_narrate')) {
        const output = JSON.parse(delivered[1])
        for (const segment of output.segments ?? []) if (segment.type === 'utterance') utterances.push({ turn: call.turn ?? row.data.turn, character: segment.character, text: segment.text })
      }
    }
  }
  return { rounds, utterances }
}

/** What the memory holds, read from the session database. */
export function snapshotOf(db) {
  const all = (sql) => db.prepare(sql).all()
  const keyOf = new Map(all('SELECT id, source_id AS sourceId, name FROM characters').map(row => [row.id, row.sourceId ?? row.name]))
  const involves = new Map()
  for (const row of all('SELECT event_id AS eventId, character_id AS characterId FROM event_involves')) involves.set(row.eventId, [...(involves.get(row.eventId) ?? []), keyOf.get(row.characterId)])
  const perceived = new Map()
  for (const row of all('SELECT event_id AS eventId, content FROM perceptions')) perceived.set(row.eventId, [...(perceived.get(row.eventId) ?? []), row.content])
  const events = all('SELECT id, turn, round, text, importance, tags FROM events ORDER BY id').map(row => ({ ...row, tags: JSON.parse(row.tags), involves: involves.get(row.id) ?? [], perceptions: perceived.get(row.id) ?? [] }))
  const threads = all("SELECT id, text FROM story_threads WHERE status = 'open'")
  const pending = all('SELECT turn, round FROM pending_commits').map(row => `${row.turn}.${row.round}`)
  return { events, threads, pending }
}

/** The fidelity of the memory to the decisions: every figure is a count with the cases behind it, so a figure can be checked by hand. */
export function scoreFidelity(truth, snapshot) {
  const { events } = snapshot
  const byTurn = Map.groupBy(events, event => event.turn)
  const missed = []
  const covered = []
  const waiting = new Set(snapshot.pending ?? [])
  for (const round of truth.rounds) {
    if (waiting.has(`${round.turn}.${round.round}`)) continue
    for (const outcome of round.outcomes) {
      const here = (byTurn.get(round.turn) ?? []).filter(event => event.round === round.round)
      const hit = here.some(event => event.involves.includes(outcome.character))
      const lenient = (byTurn.get(round.turn) ?? []).some(event => event.involves.includes(outcome.character))
      ;(hit ? covered : missed).push({ turn: round.turn, round: round.round, character: outcome.character, inTurn: lenient })
    }
  }
  const decided = new Map(truth.rounds.map(round => [`${round.turn}.${round.round}`, new Set([...round.characters, ...round.outcomes.map(outcome => outcome.character)])]))
  const spurious = events.filter(event => {
    const actors = decided.get(`${event.turn}.${event.round}`)
    return actors === undefined || (event.involves.length > 0 && !event.involves.some(key => actors.has(key)))
  }).map(event => ({ id: event.id, turn: event.turn, round: event.round, text: event.text.slice(0, 80) }))
  const merged = truth.rounds.flatMap((round) => {
    const here = events.filter(event => event.turn === round.turn && event.round === round.round)
    return here.filter(event => round.outcomes.filter(outcome => event.involves.includes(outcome.character)).length >= 3).map(event => ({ id: event.id, turn: round.turn, round: round.round }))
  })
  const unwrittenTurns = new Set([...waiting].map(key => Number(key.split('.')[0])))
  const heardAbout = truth.utterances.filter(utterance => !unwrittenTurns.has(utterance.turn))
  const unheard = heardAbout.filter((utterance) => {
    const said = words(utterance.text)
    return !(byTurn.get(utterance.turn) ?? []).some(event => overlapShare(said, words([event.text, ...event.perceptions].join(' '))) >= 0.6)
  })
  const duplicateEvents = []
  for (const [, here] of byTurn) for (const [index, a] of here.entries()) for (const b of here.slice(index + 1)) if (jaccard(words(a.text), words(b.text)) >= 0.45) duplicateEvents.push([a.id, b.id])
  const duplicateThreads = []
  const open = snapshot.threads.map(thread => ({ id: thread.id, text: thread.text, words: words(thread.text) }))
  for (const [index, a] of open.entries()) for (const b of open.slice(index + 1)) if (jaccard(a.words, b.words) >= 0.5) duplicateThreads.push([a.id, b.id])
  const counts = new Map()
  for (const event of events) for (const tag of event.tags) counts.set(tag.toLowerCase(), (counts.get(tag.toLowerCase()) ?? 0) + 1)
  const tags = [...counts.keys()]
  const sameForm = []
  for (const [index, a] of tags.entries()) for (const b of tags.slice(index + 1)) if (stem(a) === stem(b) || (a.length >= 4 && b.startsWith(a)) || (b.length >= 4 && a.startsWith(b))) sameForm.push([a, b])
  const outcomes = covered.length + missed.length
  return {
    rounds: truth.rounds.length, waiting: waiting.size, outcomes, events: events.length,
    missed, spurious, merged, unheard, duplicateEvents, duplicateThreads, sameForm,
    tags: { distinct: tags.length, singletons: [...counts.values()].filter(count => count === 1).length },
    rates: {
      missed: outcomes === 0 ? 0 : missed.length / outcomes,
      missedEvenInTurn: outcomes === 0 ? 0 : missed.filter(entry => !entry.inTurn).length / outcomes,
      spurious: events.length === 0 ? 0 : spurious.length / events.length,
      unheard: heardAbout.length === 0 ? 0 : unheard.length / heardAbout.length,
    },
    utterances: heardAbout.length,
  }
}

/** Where each turn's time went, from the chat log and the helper logs that began during it. */
export function timingOf(rows, helperLogs) {
  const starts = rows.flatMap((row, index) => (row.type === 'turn/start' ? [index] : []))
  return starts.map((from, position) => {
    const to = starts[position + 1] ?? rows.length
    const turn = rows.slice(from, to)
    const began = Number(turn[0].time)
    const ended = Number(turn.at(-1).time)
    const calls = turn.filter(row => row.type === 'tool/call').map(row => row.data.name)
    const firstStep = turn.find(row => row.type === 'step/start')
    const next = starts[position + 1] === undefined ? Infinity : Number(rows[starts[position + 1]].time)
    const helpers = helperLogs.filter(log => log.start >= began && log.start < next)
    const lookups = helpers.flatMap(log => log.calls).filter(name => name.startsWith('recall_my_'))
    let stepStart = began
    const steps = []
    for (const row of turn) {
      if (row.type === 'step/start') stepStart = Number(row.time)
      if (row.type === 'assistant/message') steps.push({ input: row.data.usage?.inputTokens ?? 0, output: row.data.usage?.outputTokens ?? 0, seconds: (Number(row.time) - stepStart) / 1000 })
    }
    return {
      turn: turn.find(row => row.data?.turn !== undefined)?.data.turn ?? position + 1,
      seconds: (ended - began) / 1000,
      firstRequestWait: firstStep === undefined ? 0 : (Number(firstStep.time) - began) / 1000,
      gameMasterSteps: steps.length,
      gameMasterSeconds: steps.reduce((sum, step) => sum + step.seconds, 0),
      inputTokens: steps[0]?.input ?? 0,
      lastInputTokens: steps.at(-1)?.input ?? 0,
      outputTokens: steps.reduce((sum, step) => sum + step.output, 0),
      longestStep: Math.max(0, ...steps.map(step => step.seconds)),
      gameMasterCalls: calls.length,
      gameMasterPulls: calls.filter(name => GM_PULLS.test(name)).length,
      refusals: turn.filter(row => row.type === 'tool/result' && row.data.message?.isError === true).length,
      helpers: helpers.length,
      helperSeconds: helpers.reduce((sum, log) => sum + log.took, 0) / 1000,
      lookups: lookups.length,
      helperCalls: helpers.reduce((sum, log) => sum + log.calls.length, 0),
    }
  })
}

const readLog = (file) => execFileSync('/usr/bin/zstd', ['-dc', file], { maxBuffer: 1 << 30 }).toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))

function main() {
  const args = process.argv.slice(2)
  const id = args.find(arg => !arg.startsWith('--') && !args[args.indexOf(arg) - 1]?.startsWith('--'))
  const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
  if (id === undefined) { console.error('usage: fidelity.mjs <session uuid> [--root <roleplay root>] [--sessions <dsh sessions dir>] [--json]'); process.exit(2) }
  const root = option('--root', join(homedir(), 'workspace', 'dsh-roleplay'))
  const sessions = option('--sessions', join(homedir(), '.dsh', 'sessions'))
  const logs = readdirSync(sessions).flatMap(folder => readdirSync(join(sessions, folder)).filter(name => existsSync(join(sessions, folder, name, 'session.v4.jsonl.zstd'))).map(name => ({ name, file: join(sessions, folder, name, 'session.v4.jsonl.zstd') })))
  const chat = logs.find(log => log.name === `session-${id}`)
  if (chat === undefined) { console.error(`no chat log for ${id}`); process.exit(1) }
  const rows = readLog(chat.file)
  const helperLogs = logs.filter(log => log.name !== chat.name).flatMap((log) => {
    const first = readLog(log.file)
    const start = Number(first.find(row => Number(row.time) > 0)?.time ?? 0)
    return [{ start, took: Number(first.at(-1).time) - start, calls: first.filter(row => row.type === 'tool/call').map(row => row.data.name) }]
  })
  const db = new DatabaseSync(join(root, 'sessions', id, 'session.sqlite'), { readOnly: true })
  const report = { fidelity: scoreFidelity(parseTruth(rows), snapshotOf(db)), timing: timingOf(rows, helperLogs) }
  if (args.includes('--json')) { console.log(JSON.stringify(report, null, 2)); return }
  const f = report.fidelity
  const pct = (value) => `${(value * 100).toFixed(0)}%`
  console.log(`rounds ${f.rounds} (${f.waiting} not written yet), checked outcomes ${f.outcomes}, events ${f.events}, utterances ${f.utterances}`)
  console.log(`missed outcomes ${f.missed.length} (${pct(f.rates.missed)}; none anywhere in the turn: ${pct(f.rates.missedEvenInTurn)})`)
  console.log(`spurious events ${f.spurious.length} (${pct(f.rates.spurious)}), merged events ${f.merged.length}, utterances in no record ${f.unheard.length} (${pct(f.rates.unheard)})`)
  console.log(`events of one turn that say nearly the same ${f.duplicateEvents.length}`)
  console.log(`open threads that look duplicated ${f.duplicateThreads.length}, tags ${f.tags.distinct} (${f.tags.singletons} used once), tags that differ only in form ${f.sameForm.length}`)
  for (const entry of f.missed) console.log(`  missed: turn ${entry.turn} round ${entry.round} ${entry.character}${entry.inTurn ? ' (recorded in another round of the turn)' : ''}`)
  for (const entry of f.spurious) console.log(`  spurious: event ${entry.id} (turn ${entry.turn}.${entry.round}) ${entry.text}`)
  for (const entry of f.unheard) console.log(`  unheard: turn ${entry.turn} ${entry.character}: ${entry.text.slice(0, 110)}`)
  for (const pair of f.sameForm) console.log(`  tags: ${pair.join(' / ')}`)
  console.log('\nturn  seconds  GM model s  longest step  input tokens (first, last)  output tokens  GM calls  GM pulls  refused  helpers  helper s  lookups')
  for (const t of report.timing) console.log([t.turn, Math.round(t.seconds), Math.round(t.gameMasterSeconds), Math.round(t.longestStep), `${t.inputTokens}, ${t.lastInputTokens}`, t.outputTokens, t.gameMasterCalls, t.gameMasterPulls, t.refusals, t.helpers, Math.round(t.helperSeconds), t.lookups].map(value => String(value).padStart(10)).join(' '))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
