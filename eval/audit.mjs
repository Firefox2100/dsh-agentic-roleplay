// A retrospective audit of a finished story: read-only over the session's database, scored by a judge model called directly.
// Each dimension starts at 100 and loses the penalty of every named error the judge found with evidence; the model never writes a score.
// When the evidence cannot show a dimension (for instance a scope with no records) the judge abstains and the score is null.
// The criteria list errors only, in an editable file; narrative quality is not scored here.
//
//   node eval/audit.mjs <session folder> --url <openai base url> --model <name> [--key k] [--criteria file] [--scope story|character:<name>|turn:<n>] [--out file]
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const here = dirname(fileURLToPath(import.meta.url))
const MAX_EVIDENCE_CHARS = 24_000
const CALL_TIMEOUT_MS = 180_000

/** The criteria file: dimensions, each with the errors it may charge and what each costs. */
export function loadCriteria(file = join(here, 'audit-criteria.json')) {
  const { dimensions } = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(dimensions) || dimensions.length === 0) throw new Error('the criteria need at least one dimension')
  for (const dimension of dimensions) {
    if (typeof dimension.id !== 'string' || !Array.isArray(dimension.errors) || dimension.errors.length === 0) throw new Error(`a dimension needs an id and errors: ${JSON.stringify(dimension).slice(0, 80)}`)
    for (const error of dimension.errors) if (typeof error.id !== 'string' || !(error.penalty > 0)) throw new Error(`the error "${error.id}" of ${dimension.id} needs an id and a penalty above 0`)
  }
  return dimensions
}

/** `story`, `character:<name>` or `turn:<n>`. */
export function parseScope(text = 'story') {
  if (text === 'story') return { kind: 'story' }
  const [kind, value] = [text.slice(0, text.indexOf(':')), text.slice(text.indexOf(':') + 1)]
  if (kind === 'character' && value !== '') return { kind, name: value }
  if (kind === 'turn' && /^\d+$/.test(value)) return { kind, turn: Number(value) }
  throw new Error(`the scope must be story, character:<name> or turn:<n>, not "${text}"`)
}

const clip = (text, limit) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text)

/** What the judge may read: the records of the scope, with who was involved, and for a character what it perceived. Read-only. */
export function evidenceFrom(databasePath, scope) {
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const people = db.prepare('SELECT id, name, role, summary, personality, speech_style AS speech FROM characters ORDER BY id').all()
    const involved = new Map()
    for (const row of db.prepare('SELECT event_id, character_id FROM event_involves').all()) involved.set(row.event_id, [...(involved.get(row.event_id) ?? []), row.character_id])
    const names = new Map(people.map(person => [person.id, person.name]))
    let events = db.prepare('SELECT id, turn, round, text, importance FROM events ORDER BY turn, round, id').all()
    let subject
    if (scope.kind === 'character') {
      subject = people.find(person => person.name.toLowerCase() === scope.name.toLowerCase())
      if (subject === undefined) throw new Error(`there is no character named "${scope.name}"`)
      const seen = new Set(db.prepare('SELECT event_id FROM perceptions WHERE character_id = ?').all(subject.id).map(row => row.event_id))
      events = events.filter(event => seen.has(event.id) || (involved.get(event.id) ?? []).includes(subject.id))
    } else if (scope.kind === 'turn') {
      events = events.filter(event => event.turn >= scope.turn - 2 && event.turn <= scope.turn)
    }
    const lines = events.map(event => `[turn ${event.turn}.${event.round}, record ${event.id}] ${event.text} (involves: ${(involved.get(event.id) ?? []).map(id => names.get(id) ?? id).join(', ') || 'nobody listed'})`)
    let perceived = []
    if (subject !== undefined) {
      perceived = db.prepare('SELECT p.event_id, p.mode, p.content, p.accuracy FROM perceptions p WHERE p.character_id = ? ORDER BY p.event_id').all(subject.id)
        .map(row => `[record ${row.event_id}] ${subject.name} ${row.mode}: ${row.content}${row.accuracy === 'accurate' ? '' : ` (${row.accuracy})`}`)
    }
    return { people, subject, lines, perceived, count: events.length }
  } finally { db.close() }
}

/** The text the judge reads, cut from the front when it is too long (the latest records matter most). */
export function render(evidence, scope, limit = MAX_EVIDENCE_CHARS) {
  const sheet = (scope.kind === 'character' ? [evidence.subject] : evidence.people).map(person => `- ${person.name} (${person.role}): ${clip(person.summary ?? '', 200)} Personality: ${clip(person.personality ?? '', 200)} Speech: ${clip(person.speech ?? '', 120)}`).join('\n')
  const parts = [`Characters:\n${sheet}`]
  if (evidence.perceived.length > 0) parts.push(`What ${evidence.subject.name} perceived:\n${evidence.perceived.join('\n')}`)
  const head = parts.join('\n\n')
  let kept = [...evidence.lines]
  const budget = Math.max(0, limit - head.length)
  while (kept.length > 1 && kept.join('\n').length > budget) kept = kept.slice(1)
  const dropped = evidence.lines.length - kept.length
  return `${head}\n\nRecords of the story${dropped > 0 ? ` (the ${dropped} oldest left out)` : ''}:\n${kept.join('\n')}`
}

/** The instruction for one dimension: errors only, evidence required, abstain when it cannot be judged. */
export function instructionFor(dimension, scope) {
  const errors = dimension.errors.map(error => `- ${error.id}: ${error.description}`).join('\n')
  return [
    `You audit a finished interactive story, read-only. Dimension: ${dimension.label}. Scope: ${scope.kind === 'story' ? 'the whole story' : scope.kind === 'character' ? `the character ${scope.name}` : `turn ${scope.turn} and the two before it`}.`,
    'Report only errors from this list, each with the record number it rests on and a short quote. Report nothing you cannot point to; do not report style, taste or improvements, and do not write a model answer.',
    errors,
    'If the records do not contain enough to judge this dimension, abstain.',
    'Answer with JSON only: {"abstain": false, "errors": [{"error": "<id>", "record": <number>, "quote": "<words from the record>", "note": "<one sentence>"}]} or {"abstain": true, "reason": "<why>"}.',
  ].join('\n')
}

/** The JSON object in a reply, after any reasoning block and code fence; undefined when there is none. */
export function parseJudgement(reply) {
  const text = reply.replace(/<think>[\s\S]*?<\/think>/g, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try { return JSON.parse(text.slice(start, end + 1)) } catch { return undefined }
}

/** The score of one dimension from a judgement: 100 less each named error's penalty (an error with no record number or an unknown id is not counted), never below 0; null when it abstained. */
export function scoreOf(dimension, judgement) {
  if (judgement === undefined || judgement.abstain === true || !Array.isArray(judgement.errors)) return { score: null, errors: [], ...(judgement?.reason === undefined ? {} : { reason: String(judgement.reason) }) }
  const known = new Map(dimension.errors.map(error => [error.id, error.penalty]))
  const counted = judgement.errors.filter(found => known.has(found.error) && Number.isInteger(found.record))
  const lost = counted.reduce((sum, found) => sum + known.get(found.error), 0)
  return { score: Math.max(0, 100 - lost), errors: counted.map(({ error, record, quote, note }) => ({ error, record, quote, note })) }
}

async function ask({ url, model, key }, system, user) {
  const response = await fetch(`${url.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key === undefined ? {} : { authorization: `Bearer ${key}` }) },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.1, max_tokens: 1500, stream: false, reasoning_effort: 'none' }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`the judge answered ${response.status}: ${(await response.text()).slice(0, 200)}`)
  return (await response.json()).choices?.[0]?.message?.content ?? ''
}

/** Audits every dimension whose scope fits (a story-wide dimension is skipped for a character scope and the other way round). */
export async function audit({ database, scope, dimensions, judge }) {
  const evidence = evidenceFrom(database, scope)
  const text = render(evidence, scope)
  const wanted = dimensions.filter(dimension => dimension.scope === 'story' || scope.kind !== 'story')
  const report = { scope, records: evidence.count, dimensions: {} }
  if (evidence.count === 0) {
    for (const dimension of wanted) report.dimensions[dimension.id] = { score: null, errors: [], reason: 'there are no records in this scope' }
    return report
  }
  for (const dimension of wanted) {
    const reply = await ask(judge, instructionFor(dimension, scope), text)
    report.dimensions[dimension.id] = scoreOf(dimension, parseJudgement(reply))
  }
  return report
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const option = (name) => { const at = args.indexOf(`--${name}`); return at < 0 ? undefined : args[at + 1] }
  const folder = args[0]?.startsWith('--') === false ? args[0] : undefined
  const url = option('url')
  const model = option('model')
  if (folder === undefined || url === undefined || model === undefined) {
    console.error('usage: node eval/audit.mjs <session folder> --url <openai base url> --model <name> [--key k] [--criteria file] [--scope story|character:<name>|turn:<n>] [--out file]')
    process.exit(2)
  }
  const scope = parseScope(option('scope'))
  const dimensions = loadCriteria(option('criteria'))
  const report = await audit({ database: join(resolve(folder), 'session.sqlite'), scope, dimensions, judge: { url, model, key: option('key') } })
  for (const [id, result] of Object.entries(report.dimensions)) {
    console.log(`${id}: ${result.score ?? 'n/a'}${result.reason === undefined ? '' : ` (${result.reason})`}`)
    for (const found of result.errors) console.log(`  - ${found.error} at record ${found.record}: ${found.note ?? ''}`)
  }
  const out = option('out')
  if (out !== undefined) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
}
