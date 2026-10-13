#!/usr/bin/env node
// Plays scripted scenarios against a running DSH with a real model and checks what the story did, so a change of model, prompt or code can be compared with a run before it.
// usage: node eval/run.mjs <dsh url with token> [--only smoke,movement] [--label qwen-35b] [--baseline eval/results/earlier.json] [--keep] [--sessions <dsh sessions dir>] [--allow-owner-root]
//   scenarios that a model plays need: --player-model <name> [--player-url http://localhost:8081/v1] [--player-key-env VAR] [--player-reasoning none|omit|low|high] [--player-turns n] [--player-tokens n] [--player-minutes n]
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Dsh } from './lib.mjs'
import { AiPlayer } from './player.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const url = args.find(arg => arg.startsWith('http'))
const option = (name) => { const at = args.indexOf(`--${name}`); return at === -1 ? undefined : args[at + 1] }
if (url === undefined) { console.error('usage: node eval/run.mjs <dsh url with token> [--only a,b] [--label text] [--baseline file] [--keep] [--sessions dir] [--allow-owner-root]'); process.exit(2) }

const only = option('only')?.split(',')
const label = option('label') ?? new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
const sessionsRoot = option('sessions') ?? join(homedir(), '.dsh', 'sessions')
const scenarios = []
for (const file of readdirSync(join(here, 'scenarios')).filter(name => name.endsWith('.mjs')).sort()) {
  const scenario = (await import(join(here, 'scenarios', file))).default
  if (only === undefined || only.includes(scenario.name)) scenarios.push(scenario)
}
if (scenarios.length === 0) { console.error('no scenario matches'); process.exit(2) }

const number = (name) => { const value = option(name); return value === undefined ? undefined : Number(value) }
const player = option('player-model') === undefined ? undefined : new AiPlayer({
  url: option('player-url') ?? 'http://localhost:8081/v1',
  model: option('player-model'),
  ...(option('player-key-env') === undefined ? {} : { key: process.env[option('player-key-env')] }),
  ...(option('player-reasoning') === undefined ? {} : { reasoning: option('player-reasoning') }),
  limits: { turns: number('player-turns'), tokens: number('player-tokens'), minutes: number('player-minutes') },
})
const skipped = scenarios.filter(scenario => scenario.aiPlayer !== undefined && player === undefined)
for (const scenario of skipped) { console.log(`(skipping ${scenario.name}: it is played by a model, and no --player-model was given)`); scenarios.splice(scenarios.indexOf(scenario), 1) }
if (scenarios.length === 0) { console.error('nothing to run'); process.exit(2) }
if (player !== undefined && scenarios.some(scenario => scenario.aiPlayer !== undefined)) console.log(`the player is ${player.model} at ${player.url}: at most ${player.limits.turns} turns, ${player.limits.tokens} tokens, ${Math.round(player.limits.ms / 60_000)} minutes`)

const dsh = await Dsh.connect(url)
const { directory } = await dsh.api('/sessions')
if (resolve(directory) === resolve(homedir(), 'workspace', 'dsh-roleplay', 'sessions') && !args.includes('--allow-owner-root')) {
  console.error(`the DSH keeps its sessions in ${directory}, which looks like your own roleplay root. Point the dev profile's rootPath at a throwaway folder first (or pass --allow-owner-root).`)
  process.exit(2)
}

const median = (values) => (values.length === 0 ? 0 : [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)])
const results = []
for (const scenario of scenarios) {
  console.log(`\n== ${scenario.name}: ${scenario.description}`)
  const checks = []
  const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail: String(detail) }); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === '' ? '' : ` (${detail})`}`) }
  const began = Date.now()
  let story
  let crashed
  try {
    const settings = scenario.records === true ? { ...scenario.settings, memory: { ...scenario.settings?.memory, backlogRounds: 1 } } : scenario.settings
    story = await dsh.start({ world: scenario.world, player: scenario.player, name: `eval ${scenario.name} ${label}`, ...(settings === undefined ? {} : { settings }) })
    story.waitForRecords = scenario.records === true
    story.sessionsRoot = sessionsRoot
    const ai = scenario.aiPlayer === undefined ? undefined : {
      play: async (target, extra = {}) => {
        const report = await player.play(target, { name: target.one("SELECT name FROM characters WHERE control = 'player'")?.name ?? 'the player', about: target.world?.description ?? '', opening: target.opening ?? '', goal: scenario.aiPlayer.goal, turnLimitMs: scenario.turnBudgetMs, ...extra })
        target.aiReport = report
        console.log(`  the model played ${report.turns} turns (${report.tokens} tokens, ${Math.round(report.ms / 1000)} s) and stopped: ${report.stop}${report.error === undefined ? '' : ` (${report.error})`}`)
        return report
      },
    }
    await scenario.run(story, check, ai)
    for (const turn of story.turns) {
      check(`turn ${turn.number} delivered within ${Math.round((scenario.turnBudgetMs ?? 8 * 60_000) / 60_000)} min`, turn.deliveredMs <= (scenario.turnBudgetMs ?? 8 * 60_000), `${Math.round(turn.deliveredMs / 1000)} s`)
    }
    if (scenario.records === true) {
      const waiting = story.one('SELECT count(*) AS n FROM pending_commits').n
      check('the records of every turn were written', waiting === 0, `${waiting} rounds still waiting`)
    }
    try {
      const calls = story.chatCalls(story.turns.length)
      check('every turn was ended with narrate', calls.filter(call => call.name === 'narrate').length >= story.turns.length, `${calls.filter(call => call.name === 'narrate').length} of ${story.turns.length}`)
    } catch (error) { console.log(`  (chat log not checked: ${error.message})`) }
  } catch (error) {
    crashed = error instanceof Error ? error.message : String(error)
    check('the scenario ran to its end', false, crashed)
  }
  const activity = story === undefined ? [] : await story.activity().catch(() => [])
  const failures = activity.filter(run => run.error !== undefined)
  const rate = activity.length === 0 ? 0 : failures.length / activity.length
  check('helpers mostly finished their work', rate <= (scenario.helperFailureRate ?? 0.25), `${failures.length} of ${activity.length} failed${failures[0] === undefined ? '' : `, for example: ${failures[0].label}: ${failures[0].error.slice(0, 120)}`}`)
  results.push({
    name: scenario.name,
    ok: checks.every(item => item.ok),
    checks,
    wallMs: Date.now() - began,
    turns: story?.turns ?? [],
    ...(story?.aiReport === undefined ? {} : { player: story.aiReport }),
    helpers: { runs: activity.length, failed: failures.length, ms: activity.reduce((sum, run) => sum + run.ms, 0), calls: activity.reduce((sum, run) => sum + run.calls, 0) },
    ...(crashed === undefined ? {} : { crashed }),
  })
  if (story !== undefined && !args.includes('--keep')) await story.delete().catch((error) => { console.log(`  (could not delete the session: ${error.message})`) })
}

const report = { label, at: new Date().toISOString(), scenarios: results }
mkdirSync(join(here, 'results'), { recursive: true })
const file = join(here, 'results', `${label}.json`)
writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)

console.log('\n== summary')
for (const result of results) console.log(`  ${result.ok ? 'ok  ' : 'FAIL'} ${result.name}: ${result.turns.length} turns, median ${Math.round(median(result.turns.map(turn => turn.deliveredMs)) / 1000)} s to deliver, ${result.helpers.runs} helper runs (${result.helpers.failed} failed)`)
console.log(`  saved ${file}`)

let regressed = results.some(result => !result.ok)
const baselineFile = option('baseline')
if (baselineFile !== undefined) {
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'))
  console.log(`\n== against ${baseline.label}`)
  for (const result of results) {
    const before = baseline.scenarios.find(item => item.name === result.name)
    if (before === undefined) { console.log(`  ${result.name}: new`); continue }
    const was = median(before.turns.map(turn => turn.deliveredMs))
    const now = median(result.turns.map(turn => turn.deliveredMs))
    const slower = was > 0 && now > was * 2
    const newlyFailing = result.checks.filter(item => !item.ok && before.checks.find(old => old.name === item.name)?.ok === true)
    console.log(`  ${result.name}: median ${Math.round(was / 1000)} s -> ${Math.round(now / 1000)} s${slower ? '  SLOWER' : ''}; helper failures ${before.helpers.failed}/${before.helpers.runs} -> ${result.helpers.failed}/${result.helpers.runs}${newlyFailing.length === 0 ? '' : `; newly failing: ${newlyFailing.map(item => item.name).join(', ')}`}`)
    if (slower || newlyFailing.length > 0) regressed = true
  }
}
process.exit(regressed ? 1 : 0)
