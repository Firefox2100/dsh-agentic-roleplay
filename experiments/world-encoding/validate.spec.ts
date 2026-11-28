import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseRecordsEdit } from '@dsh-agentic-roleplay/state'
import { loadValidatedWorld } from '../../packages/dsh-agentic-roleplay-core/src/host/worlds/validated-world.ts'
import { withScratchStory } from '../../packages/dsh-agentic-roleplay-core/src/host/worlds/scratch.ts'

/** v1 must load with the project's loaders and apply to a real story store; v2 (the model) must be internally consistent and derive what its key says; the ledger must cover every paragraph. See README.md. */
const here = fileURLToPath(new URL('.', import.meta.url))
const books = readdirSync(here, { withFileTypes: true }).filter(entry => entry.isDirectory() && (existsSync(join(here, entry.name, 'v1')) || existsSync(join(here, entry.name, 'v2')))).map(entry => entry.name)

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
type Json = Record<string, any>

describe.each(books)('%s', book => {
  const dir = join(here, book)

  it.runIf(existsSync(join(dir, 'v1')))('v1 loads with the project loaders and its history applies to a story', async () => {
    const world = join(dir, 'v1', 'world')
    const info = read(join(world, 'world.json'))
    const loaded = await loadValidatedWorld({ directory: world, summary: { name: info.name } })
    const history: Json[] = read(join(dir, 'v1', 'history.json'))
    withScratchStory({ characters: loaded.characters, locations: loaded.locations, items: loaded.items, slots: loaded.slots, variables: loaded.declared.defs, calendar: loaded.calendar }, story => {
      for (const [index, entry] of history.entries()) {
        const edit = parseRecordsEdit(entry.edit)
        try { story.edit(edit) } catch (error) { throw new Error(`history step ${index + 1} (turn ${entry.edit.turn}): ${(error as Error).message}`) }
      }
    })
  })

  it('the ledger covers every paragraph and the questions are well formed', () => {
    const text = readFileSync(join(dir, 'source', 'text.txt'), 'utf8').trim().split('\n\n')
    const covered = new Set<number>()
    const ledger: Json[] = read(join(dir, 'ledger.json'))
    for (const row of ledger) {
      const match = /^P(\d+)(?:\.\d+)?(?:-P(\d+))?$/.exec(row.ref)
      if (match === null) continue
      for (let n = Number(match[1]); n <= Number(match[2] ?? match[1]); n++) covered.add(n)
    }
    const missing = text.map((_, i) => i + 1).filter(n => text[n - 1]!.trim() !== '' && !covered.has(n))
    expect(missing).toEqual([])
    const questions: Json[] = read(join(dir, 'questions.json'))
    expect(questions.length).toBeGreaterThanOrEqual(10)
    for (const q of questions) for (const v of ['v1', 'draft', 'v2']) if (q[v] !== undefined) expect(['yes', 'partly', 'no']).toContain(q[v].answerable)
  })

  it.runIf(existsSync(join(dir, 'v2')))('v2 is consistent, derives claim verdicts and covers every paragraph', () => {
    const story: Json = read(join(dir, 'v2', 'story.json'))
    const checks: Json = read(join(dir, 'v2', 'checks.json'))
    const text = readFileSync(join(dir, 'source', 'text.txt'), 'utf8').trim().split('\n\n')
    const paragraphs = text.map((_, i) => `P${String(i + 1).padStart(2, '0')}`)
    const ids = (list: Json[] | undefined) => new Set((list ?? []).map(item => item.id))
    const people = ids(story.entities.people), places = ids(story.entities.places), things = ids(story.entities.things)
    const anchorIds = ids(story.time?.anchors)
    const eventIds = ids(story.events), stateIds = ids(story.states), claimIds = ids(story.claims), heldIds = ids(story.held), readingIds = ids(story.readings), frameIds = ids(story.frames)
    const problems: string[] = []
    const need = (set: Set<string>, id: unknown, what: string) => { if (id !== undefined && id !== null && !set.has(id as string)) problems.push(`${what}: unknown id ${String(id)}`) }
    const anyOf = (...sets: Set<string>[]) => new Set(sets.flatMap(set => [...set]))
    const moment = (value: unknown, what: string) => {
      if (value === 'start' || value === undefined || value === null) return
      if (typeof value === 'string' && value.startsWith('para:')) { if (!paragraphs.includes(value.slice(5))) problems.push(`${what}: no paragraph ${value}`) } else need(eventIds, value, what)
    }
    const covered = new Set<string>()
    const cover = (src: string[] | undefined) => { for (const para of src ?? []) { if (!paragraphs.includes(para)) problems.push(`no paragraph ${para}`); covered.add(para) } }

    for (const event of story.events as Json[]) {
      need(places, event.place, `event ${event.id} place`)
      for (const who of event.who ?? []) need(people, who.id, `event ${event.id} who`)
      for (const thing of event.things ?? []) need(things, thing, `event ${event.id} thing`)
      for (const cause of event.causes ?? []) need(eventIds, cause.event, `event ${event.id} cause`)
      if (event.frame !== undefined) need(frameIds, event.frame, `event ${event.id} frame`)
      for (const ref of [...(event.when?.after ?? []), ...(event.when?.before ?? []), ...(event.when?.within ?? [])]) need(anyOf(eventIds, anchorIds), ref, `event ${event.id} when`)
      for (const ref of event.claims ?? []) need(anyOf(claimIds, stateIds, eventIds), ref, `event ${event.id} claims`)
      for (const key of ['grounded_in', 'explains', 'contrasts']) for (const ref of event[key] ?? []) need(eventIds, ref, `event ${event.id} ${key}`)
      for (const key of ['poses']) if (event[key] !== undefined) need(eventIds, event[key], `event ${event.id} ${key}`)
      if (event.fulfils !== undefined) need(heldIds, event.fulfils, `event ${event.id} fulfils`)
      cover(event.src)
    }
    for (const frame of story.frames as Json[]) { moment(frame.starts_at, `frame ${frame.id} starts_at`); moment(frame.ends_at, `frame ${frame.id} ends_at`) }
    for (const held of story.held as Json[]) { need(people, held.who, `held ${held.id} who`); cover(held.src) }
    for (const row of story.states as Json[]) { need(anyOf(people, things, places), row.of, `state ${row.id} of`); moment(row.from, `state ${row.id} from`); moment(row.until, `state ${row.id} until`); cover(row.src) }
    for (const row of story.knowledge as Json[]) {
      need(anyOf(people, new Set(['reader'])), row.who, 'knowledge who')
      need(anyOf(eventIds, stateIds, claimIds, heldIds, readingIds), row.of, `knowledge ${row.who} of`)
      moment(row.from, `knowledge ${row.who}/${row.of} from`); moment(row.until, `knowledge ${row.who}/${row.of} until`)
      cover(row.src)
    }
    for (const reading of story.readings as Json[]) for (const key of ['supports', 'against']) for (const ref of reading[key] ?? []) need(anyOf(eventIds, stateIds, claimIds, heldIds, readingIds), ref, `reading ${reading.id} ${key}`)
    for (const reading of story.readings as Json[]) cover(reading.src)

    const seqOf = new Map<string, number>((story.events as Json[]).map(event => [event.id, event.when.seq]))
    const known = (event: Json): number => event.established_in !== undefined ? Math.max(event.when.seq, seqOf.get(event.established_in) ?? Infinity) : event.when.seq
    const knownAt = new Map<string, number>((story.events as Json[]).map(event => [event.id, known(event)]))
    const independent = checks.independent === true
    const derive = (bearings: Json[]): string => {
      const has = (as: string) => bearings.some(b => b.as === as)
      if (has('confirms') && has('contradicts')) return 'disputed'
      if (has('contradicts')) return 'false'
      if (has('confirms')) return 'true'
      if (has('disputes')) return 'disputed'
      if (has('supports') && has('undermines')) return 'open'
      if (has('supports')) return 'likely'
      if (has('undermines')) return 'unlikely'
      return 'unresolved'
    }
    const bearingsAt = (claim: Json, moment: number): Json[] => {
      const made = knownAt.get(claim.asserted_in) ?? -Infinity
      return (claim.bears_on as Json[]).filter(b => (knownAt.get(b.ref) ?? -Infinity) <= moment && Math.max(made, knownAt.get(b.ref) ?? -Infinity) <= moment)
    }
    const claimById = new Map<string, Json>((story.claims as Json[]).map(claim => [claim.id, claim]))
    const rivalsOf = (id: string): string[] => ((story.questions ?? []) as Json[]).filter(q => (q.rivals as string[]).includes(id)).flatMap(q => (q.rivals as string[]).filter(r => r !== id))
    const verdictAt = (claim: Json, at: number): string => {
      if (claim.parts !== undefined) {
        const each = (claim.parts as Json[]).map(part => derive((part.bears_on as Json[]).filter(b => Math.max(knownAt.get(claim.asserted_in) ?? -Infinity, knownAt.get(b.ref) ?? -Infinity) <= at)))
        return each.every(v => v === each[0]) ? each[0]! : 'mixed'
      }
      const rival = rivalsOf(claim.id).map(id => derive(bearingsAt(claimById.get(id)!, at)))
      const bearings = [...bearingsAt(claim, at), ...rival.filter(v => v === 'true').map(() => ({ as: 'contradicts' })), ...rival.filter(v => v === 'likely').map(() => ({ as: 'undermines' }))]
      return derive(bearings)
    }
    const verdict: Record<string, string> = {}
    for (const claim of story.claims as Json[]) {
      cover(claim.src)
      for (const b of [...((claim.bears_on ?? []) as Json[]), ...((claim.parts ?? []) as Json[]).flatMap(part => part.bears_on as Json[])]) {
        need(independent ? eventIds : anyOf(eventIds, stateIds, readingIds), b.ref, `claim ${claim.id} bears_on`)
        if (!['confirms', 'contradicts', 'supports', 'undermines', ...(independent ? [] : ['disputes'])].includes(b.as)) problems.push(`claim ${claim.id}: bad bearing ${b.as}`)
      }
      if (independent) { need(eventIds, claim.asserted_in, `claim ${claim.id} asserted_in`); need(people, claim.by, `claim ${claim.id} by`) }
      verdict[claim.id] = verdictAt(claim, Infinity)
    }
    for (const q of (story.questions ?? []) as Json[]) for (const id of q.rivals as string[]) need(claimIds, id, `question ${q.id} rivals`)
    for (const q of (story.questions ?? []) as Json[]) if ((q.rivals as string[]).length < 2 || (q.rivals as string[]).length > 4) problems.push(`question ${q.id}: ${(q.rivals as string[]).length} rivals (a set holds 2 to 4)`)
    for (const claim of story.claims as Json[]) if (claim.status !== undefined && !['proposed', 'confirmed'].includes(claim.status)) problems.push(`claim ${claim.id}: bad status ${claim.status}`)
    if (independent) {
      const origins = new Set(['offscreen', 'backfilled'])
      for (const event of story.events as Json[]) {
        if (event.basis !== undefined) problems.push(`event ${event.id}: basis is not part of this model`)
        if (event.origin !== undefined && !origins.has(event.origin)) problems.push(`event ${event.id}: bad origin ${event.origin}`)
        if (event.when?.seq === undefined) problems.push(`event ${event.id}: no seq`)
        if (event.established_in !== undefined) { need(eventIds, event.established_in, `event ${event.id} established_in`); if ((seqOf.get(event.established_in) ?? -Infinity) < event.when.seq && event.origin === 'backfilled' && event.when.seq > 0) problems.push(`event ${event.id}: established before it happens`) }
        if (event.origin === 'backfilled' && event.established_in === undefined) problems.push(`event ${event.id}: backfilled with no scene that established it`)
        if (event.kind === 'conceal') { if (event.from === undefined) problems.push(`event ${event.id}: conceals from no one`); for (const from of [event.from].flat()) need(people, from, `event ${event.id} from`) }
        need(anyOf(eventIds, new Set(['']), heldIds), event.prevents, `event ${event.id} prevents`)
      }
      for (const [id, at, expected] of (checks.verdict_at ?? []) as [string, string, string][]) {
        const claim = (story.claims as Json[]).find(c => c.id === id)
        if (claim === undefined) { problems.push(`verdict_at: no claim ${id}`); continue }
        const got = verdictAt(claim, knownAt.get(at) ?? Infinity)
        if (got !== expected) problems.push(`claim ${id} after ${at}: derived ${got}, expected ${expected}`)
      }
      for (const [id, expected] of Object.entries((checks.held_outcomes ?? {}) as Record<string, string>)) {
        const outcome = (hid: string): string => {
          const fulfilled = (story.events as Json[]).some(e => e.fulfils === hid), prevented = (story.events as Json[]).some(e => e.prevents === hid)
          if (fulfilled) return 'fulfilled'
          if (prevented) return 'prevented'
          const conditions = ((story.held as Json[]).find(h => h.id === hid)?.if ?? []) as string[]
          const states = conditions.map(outcome)
          return states.includes('prevented') || states.includes('void') ? 'void' : states.some(x => x !== 'fulfilled') ? 'waiting' : 'open'
        }
        const got = outcome(id)
        if (got !== expected) problems.push(`held ${id}: derived ${got}, expected ${expected}`)
      }
      const span = (id: string) => (story.events as Json[]).find(e => e.id === id)?.when?.t as [number, number] | undefined
      for (const [a, b, expected] of (checks.simultaneous ?? []) as [string, string, boolean][]) {
        const x = span(a), y = span(b)
        if (x === undefined || y === undefined) { problems.push(`simultaneous: ${a} or ${b} has no t`); continue }
        const overlap = x[0] < y[1] && y[0] < x[1]
        if (overlap !== expected) problems.push(`simultaneous ${a}/${b}: derived ${overlap}`)
      }
      const seqAt = (m: string): number => m === 'start' ? -Infinity : m.startsWith('para:') ? Math.min(Infinity, ...(story.events as Json[]).filter(e => e.origin !== 'backfilled' && Number((e.src as string[])[0]!.slice(1)) >= Number(m.slice(6))).map(e => e.when.seq as number)) : (seqOf.get(m) ?? Infinity)
      const before = new Map<string, string[]>()
      for (const e of story.events as Json[]) {
        for (const x of e.when.after ?? []) before.set(x, [...(before.get(x) ?? []), e.id])
        for (const x of e.when.before ?? []) before.set(e.id, [...(before.get(e.id) ?? []), x])
      }
      const sceneOf = new Map<string, string>((story.events as Json[]).filter(e => e.scene !== undefined).map(e => [e.id, e.scene]))
      for (const a of story.events as Json[]) for (const b of story.events as Json[]) if (a.scene !== undefined && a.scene === b.scene && a.when.seq < b.when.seq) before.set(a.id, [...(before.get(a.id) ?? []), b.id])
      const reaches = (a: string, b: string): boolean => { const seen = new Set<string>(); const walk = (n: string): boolean => n === b || (!seen.has(n) && (seen.add(n), (before.get(n) ?? []).some(walk))); return a !== b && walk(a) }
      for (const [a, b, expected] of (checks.order ?? []) as [string, string, string][]) {
        const got = reaches(a, b) ? 'before' : reaches(b, a) ? 'after' : 'unordered'
        if (got !== expected) problems.push(`order ${a}/${b}: derived ${got}, expected ${expected}`)
      }
      const heard = (event: Json, person: string): boolean => {
        if ((event.who as Json[]).some(x => x.id === person)) return true
        if (event.audience !== undefined) return (event.audience as string[]).includes(person)
        return (story.states as Json[]).some(row => row.kind === 'concealment' && row.of === person && seqAt(row.from) < event.when.seq && event.when.seq < seqAt(row.until ?? 'para:P999'))
      }
      for (const [at, person, expected] of (checks.heard_by ?? []) as [string, string, boolean][]) {
        const event = (story.events as Json[]).find(e => e.id === at)
        if (event === undefined) { problems.push(`heard_by: no event ${at}`); continue }
        if (heard(event, person) !== expected) problems.push(`heard_by ${at}/${person}: derived ${heard(event, person)}`)
      }
      for (const [at, person, claimId, expected] of (checks.false_beliefs ?? []) as [string, string, string, boolean][]) {
        const now = seqAt(at)
        const believes = (story.knowledge as Json[]).some(row => row.who === person && row.of === claimId && row.stance === 'believes' && seqAt(row.from) <= now && now < seqAt(row.until ?? 'para:P999'))
        const untrue = ['false', 'unlikely'].includes(verdictAt(claimById.get(claimId)!, knownAt.get(at) ?? Infinity))
        if ((believes && untrue) !== expected) problems.push(`false_belief ${person}/${claimId} at ${at}: derived ${believes && untrue}`)
      }
      const knowsEvent = (person: string, id: string, now: number, party = false): boolean => {
        const event = (story.events as Json[]).find(e => e.id === id)
        if (event === undefined) return false
        const told = (story.knowledge as Json[]).some(row => row.who === person && row.of === id && ['knows', 'believes'].includes(row.stance) && seqAt(row.from) <= now && now < seqAt(row.until ?? 'para:P999'))
        if ((story.knowledge as Json[]).some(row => row.who === person && row.of === id && row.stance === 'unaware' && seqAt(row.from) <= now && now < seqAt(row.until ?? 'para:P999'))) return false
        const takesPart = (event.who as Json[]).some(x => x.id === person && x.role !== 'overhearer')
        return told || (event.when.seq <= now && (party ? takesPart : heard(event, person)))
      }
      for (const [at, person, of, expected] of (checks.knows_at ?? []) as [string, string, string, boolean][]) {
        const claim = claimById.get(of)
        const got = knowsEvent(person, claim === undefined ? of : claim.asserted_in, seqAt(at))
        if (got !== expected) problems.push(`knows_at ${person}/${of} at ${at}: derived ${got}`)
      }
      const inGroup = (person: string, group: string, seen = new Set<string>()): boolean => {
        if (seen.has(group)) return false
        seen.add(group)
        const list = ((story.entities.people as Json[]).find(p => p.id === group)?.may_include ?? []) as string[]
        return list.includes(person) || list.some(member => inGroup(person, member, seen))
      }
      for (const [at, person, of, expected] of (checks.knows3 ?? []) as [string, string, string, string][]) {
        const event = (story.events as Json[]).find(e => e.id === of)!
        const now = seqAt(at)
        const unaware = (story.knowledge as Json[]).some(row => row.who === person && row.of === of && row.stance === 'unaware')
        const groups = (event.who as Json[]).filter(x => x.role !== 'overhearer').map(x => x.id as string).filter(id => id !== person)
        const got = knowsEvent(person, of, now) ? 'knows' : !unaware && event.when.seq <= now && groups.some(g => inGroup(person, g)) ? 'possibly' : 'no'
        if (got !== expected) problems.push(`knows3 ${person}/${of} at ${at}: derived ${got}`)
      }
      const heldRow = (id: string): Json => (story.held as Json[]).find(h => h.id === id)!
      const settleEvent = (id: string, key: 'fulfils' | 'prevents'): Json | undefined => (story.events as Json[]).find(e => e[key] === id)
      for (const [id, at, view, expected] of (checks.due_outcomes ?? []) as [string, string, string, string][]) {
        const held = heldRow(id), now = (story.events as Json[]).find(e => e.id === at)!
        const nowT = now.when.t?.[0] as number
        const done = settleEvent(id, 'fulfils')
        const reached = done !== undefined && (view === 'world' ? done.when.t[0] <= nowT : done.when.seq <= now.when.seq)
        const nowAt = view === 'world' ? nowT : (story.events as Json[]).filter(e => e.when.seq <= now.when.seq && e.when.t !== undefined).reduce((m, e) => Math.max(m, e.when.t[0] as number), -Infinity)
        const got = reached ? 'fulfilled' : held.due !== undefined && nowAt > held.due.t ? 'overdue' : 'open'
        if (got !== expected) problems.push(`due_outcomes ${id} at ${at} (${view}): derived ${got}`)
      }
      for (const [id, expected] of (checks.timeliness ?? []) as [string, string][]) {
        const held = heldRow(id), done = settleEvent(id, 'fulfils')!
        const got = done.when.t[0] <= held.due.t ? 'on-time' : 'late'
        if (got !== expected) problems.push(`timeliness ${id}: derived ${got}`)
      }
      for (const [at, person, expected] of (checks.owed ?? []) as [string, string, [string, number, string, string][]][]) {
        const now = seqAt(at)
        const rows = (story.held as Json[]).filter(h => h.amount !== undefined && h.payer === person && seqAt(h.from) <= now).map(h => {
          const conditions = (h.if ?? []) as string[]
          const settled = (id: string): boolean => (story.events as Json[]).some(e => (e.fulfils === id || e.prevents === id) && e.when.seq <= now)
          if (settled(h.id)) return undefined
          return [h.id, h.amount.value, h.amount.unit, conditions.some(c => !(story.events as Json[]).some(e => e.fulfils === c && e.when.seq <= now)) ? 'conditional' : 'due']
        }).filter(row => row !== undefined)
        if (JSON.stringify(rows) !== JSON.stringify(expected)) problems.push(`owed ${person} at ${at}: derived ${JSON.stringify(rows)}`)
      }
      for (const [a, b, expected] of (checks.gaps ?? []) as [string, string, [number, string | null, string | null][]][]) {
        const x = (story.events as Json[]).find(e => e.id === a)!.when, y = (story.events as Json[]).find(e => e.id === b)!.when
        const ties = ((story.time?.ties ?? []) as Json[]).filter(tie => (tie.a.epoch === x.epoch && tie.b.epoch === y.epoch) || (tie.b.epoch === x.epoch && tie.a.epoch === y.epoch))
        const rows: [number, string | null, string | null][] = x.epoch === y.epoch ? [[y.t[0] - x.t[0], null, null]] : ties.map(tie => {
          const forward = tie.a.epoch === x.epoch
          const shift = forward ? tie.b.t - tie.a.t : tie.a.t - tie.b.t
          return [y.t[0] - (x.t[0] + shift), tie.under, verdict[tie.under]!] as [number, string | null, string | null]
        })
        if (JSON.stringify(rows.sort((p, q) => p[0] - q[0])) !== JSON.stringify(expected)) problems.push(`gaps ${a}/${b}: derived ${JSON.stringify(rows)}`)
      }
      for (const [id, expected] of (checks.lies ?? []) as [string, boolean][]) {
        const claim = claimById.get(id)!
        const rivals = rivalsOf(id)
        const against = [...((claim.bears_on ?? []) as Json[]).filter(b => b.as === 'contradicts').map(b => b.ref as string), ...rivals.flatMap(r => (((claimById.get(r)!.bears_on ?? []) as Json[]).filter(b => b.as === 'confirms').map(b => b.ref as string)))]
        const lie = against.some(ref => knowsEvent(claim.by, ref, seqOf.get(claim.asserted_in) ?? Infinity, true))
        if (lie !== expected) problems.push(`lies ${id}: derived ${lie}`)
      }
      for (const [id, person, expected] of (checks.cites_unheard ?? []) as [string, string, boolean][]) {
        const claim = claimById.get(id)!
        const spoke = (story.events as Json[]).some(e => e.when.seq < (seqOf.get(claim.asserted_in) ?? Infinity) && (e.who as Json[]).some(x => x.id === person && ['speaker', 'agent'].includes(x.role)) && e.origin === undefined)
        const unheard = (claim.cites as string[] | undefined)?.includes(person) === true && !spoke
        if (unheard !== expected) problems.push(`cites_unheard ${id}/${person}: derived ${unheard}`)
      }
      const intervalOf = (id: string): { t: [number, number]; exact: boolean; epoch: string } | undefined => {
        const e = (story.events as Json[]).find(x => x.id === id)
        if (e === undefined) return undefined
        if (e.when.t !== undefined) return { t: e.when.t, exact: true, epoch: e.when.epoch ?? '' }
        for (const parent of e.when.within ?? []) { const p = intervalOf(parent); if (p !== undefined) return { ...p, exact: false } }
        return undefined
      }
      for (const [a, b, expected] of (checks.overlap3 ?? []) as [string, string, string][]) {
        const x = intervalOf(a), y = intervalOf(b)
        const got = x === undefined || y === undefined ? 'unknown' : x.epoch !== y.epoch || !(x.t[0] < y.t[1] && y.t[0] < x.t[1]) ? 'none' : x.exact && y.exact ? 'definite' : 'possible'
        if (got !== expected) problems.push(`overlap3 ${a}/${b}: derived ${got}`)
      }
      for (const [id, person, at, expected] of (checks.verdict_for ?? []) as [string, string, string, string][]) {
        const claim = claimById.get(id)!
        const now = seqAt(at)
        const seenOf = (c: Json): Json[] => (c.bears_on as Json[] ?? []).filter(b => knowsEvent(person, b.ref, now))
        const viewOf = (c: Json): string => {
          if (c.parts !== undefined) { const each = (c.parts as Json[]).map(part => derive((part.bears_on as Json[]).filter(b => knowsEvent(person, b.ref, now)))); return each.every(v => v === each[0]) ? each[0]! : 'mixed' }
          const rival = rivalsOf(c.id).map(r => derive(seenOf(claimById.get(r)!)))
          return derive([...seenOf(c), ...rival.filter(v => v === 'true').map(() => ({ as: 'contradicts' })), ...rival.filter(v => v === 'likely').map(() => ({ as: 'undermines' }))])
        }
        const got = viewOf(claim)
        if (got !== expected) problems.push(`verdict_for ${id}/${person} at ${at}: derived ${got}, expected ${expected}`)
      }
      const causeClosure = (id: string, seen = new Set<string>()): Set<string> => { for (const c of ((story.events as Json[]).find(e => e.id === id)?.causes ?? []) as Json[]) if (!seen.has(c.event)) { seen.add(c.event); causeClosure(c.event, seen) } return seen }
      for (const [id, claimId, expected] of (checks.rests_on_untrue ?? []) as [string, string, boolean][]) {
        const claim = claimById.get(claimId)!
        const rests = causeClosure(id).has(claim.asserted_in) && ['false', 'unlikely'].includes(verdict[claimId]!)
        if (rests !== expected) problems.push(`rests_on_untrue ${id}/${claimId}: derived ${rests}`)
      }
      const played = (story.events as Json[]).filter(e => e.origin === undefined && e.when.t !== undefined).sort((p, q) => p.when.seq - q.when.seq)
      const first = (e: Json) => Number((e.src as string[])[0]!.slice(1))
      let floor = Infinity
      const late: string[] = []
      for (const e of [...played].reverse()) { if (first(e) > floor) late.push(e.id); floor = Math.min(floor, first(e)) }
      late.reverse()
      expect(late).toEqual(checks.told_late ?? [])
    }
    for (const [id, expected] of Object.entries(checks.expected_verdicts as Record<string, string>)) {
      const accepted = (checks.accepted_differences ?? {})[id]
      if (verdict[id] !== expected && verdict[id] !== accepted) problems.push(`claim ${id}: derived ${verdict[id]}, key says ${expected}`)
    }
    for (const [i, para] of paragraphs.entries()) if (text[i]!.trim() !== '' && !covered.has(para) && !(checks.exempt_paragraphs ?? {})[para]) problems.push(`paragraph ${para} is in no record's src`)
    expect(problems).toEqual([])
  })
})
