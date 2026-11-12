import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { evaluate, held, type Script } from './index.ts'
import { compose, ComposeError, coverage, describeCoverage, featuresOf, loadData, mergePatch, tierOf, validateData, worldOfRow, type Layer, type Row } from './index.ts'

/** The framework itself, on a small world made up here: the data under `data/` is checked by `data.spec.ts`. */
let root: string

const write = (path: string, value: unknown): void => {
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`)
}

const person = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, role: 'playable', ...extra })
const row = (extra: Partial<Row> = {}): Row => ({ id: 'r', world: 'tiny', language: 'en', layers: [], cast: { player: 'ann', npcs: 1 }, features: ['places'], why: 'x', report: [], ...extra })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bench-framework-'))
  write('worlds/tiny/bench.json', { id: 'tiny', name: 'Tiny', theme: 'daily', languages: { en: { native: true } }, purpose: 'a test' })
  write('worlds/tiny/en/world/world.json', { id: 'tiny', name: 'Tiny' })
  write('worlds/tiny/en/world/characters/ann/character.json', person('ann'))
  write('worlds/tiny/en/world/characters/bob/character.json', person('bob', { role: 'npc' }))
  write('worlds/tiny/en/world/locations/home/location.json', { id: 'home', name: 'Home' })
  write('worlds/tiny/en/layers/dice.json', { id: 'dice', add: { 'dice.json': { checks: [] } } })
  write('worlds/tiny/en/layers/hours.json', { id: 'hours', requires: ['dice'], patch: { 'characters/bob/character.json': { routine: [{ days: ['mon'], from: '08:00', to: '09:00' }] } } })
  write('worlds/tiny/en/layers/commands.json', { id: 'commands', add: { 'commands.json': { commands: [{ word: 'recruit', description: 'Bring someone in.' }, { word: '招募', key: 'zhaomu', description: '招人' }] } } })
  write('worlds/tiny/en/layers/fantasy-spell.json', { id: 'fantasy-spell', fits: ['fantasy'], add: { 'spells.json': [] } })
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('composing a world from its layers', () => {
  it('merges patches as RFC 7386 does: objects merge, null removes, arrays are replaced', () => {
    expect(mergePatch({ a: 1, b: { c: 2, d: 3 }, e: [1, 2] }, { b: { c: null, f: 4 }, e: [9] })).toEqual({ a: 1, b: { d: 3, f: 4 }, e: [9] })
  })

  it('removes, adds, then patches, and leaves the bare world alone', () => {
    const base = new Map<string, unknown>([['a.json', { x: 1 }], ['dir/b.json', { y: 1 }]])
    const layer: Layer = { id: 'l', description: '', requires: [], conflicts: [], fits: [], remove: ['dir'], add: { 'c.json': { z: 1 } }, patch: { 'a.json': { x: 2 } } }
    const made = compose(base, [layer])
    expect([...made.keys()].sort()).toEqual(['a.json', 'c.json'])
    expect(made.get('a.json')).toEqual({ x: 2 })
    expect(base.get('a.json')).toEqual({ x: 1 })
  })

  it('refuses to patch or remove what the world does not have', () => {
    const missing: Layer = { id: 'm', description: '', requires: [], conflicts: [], fits: [], remove: [], add: {}, patch: { 'nope.json': { a: 1 } } }
    expect(() => compose(new Map(), [missing])).toThrow(ComposeError)
    expect(() => compose(new Map(), [{ ...missing, patch: {}, remove: ['nope'] }])).toThrow(/does not have/)
  })
})

describe('reading the features and the cast of a world', () => {
  it('finds what the files carry, and a row claims exactly that', () => {
    const data = loadData(root)
    expect(featuresOf(worldOfRow(data, row()).files)).toEqual(['places'])
    expect(featuresOf(worldOfRow(data, row({ layers: ['dice', 'hours'] })).files)).toEqual(['places', 'dice', 'routines'])
    expect(tierOf(1)).toBe('solo')
    expect(tierOf(3)).toBe('small')
    expect(tierOf(7)).toBe('ensemble')
  })
})

describe('what the data validation refuses', () => {
  const check = (rows: Row[], excluded: unknown[] = []): string[] => {
    write('rows/rows.json', rows)
    write('excluded.json', excluded)
    return validateData(loadData(root))
  }

  it('accepts a sound row', () => {
    expect(check([row()])).toEqual([])
    expect(check([row({ layers: ['dice', 'hours'], features: ['places', 'dice', 'routines'] })])).toEqual([])
  })

  it('refuses an unknown world, language or layer, a missing requirement and a duplicate id', () => {
    expect(check([row({ world: 'nowhere' })])).toEqual([expect.stringContaining('unknown world')])
    expect(check([row({ language: 'zh' })])).toEqual([expect.stringContaining('no zh version')])
    expect(check([row({ layers: ['ghost'] })])[0]).toMatch(/unknown layer "ghost"/)
    expect(check([row({ layers: ['hours'], features: ['places', 'routines'] })])).toEqual([expect.stringContaining('needs dice')])
    expect(check([row(), row()])).toEqual([expect.stringContaining('used twice')])
  })

  it('refuses a claim the world does not bear out, a player who is not there and a wrong cast size', () => {
    expect(check([row({ features: ['places', 'dice'] })])[0]).toMatch(/claims features \[places, dice\] but the world has \[places\]/)
    expect(check([row({ cast: { player: 'zed', npcs: 1 } })])[0]).toMatch(/player zed is not among/)
    expect(check([row({ cast: { player: 'ann', npcs: 4 } })])[0]).toMatch(/claims 4 other characters but the world has 1/)
  })

  it('refuses a layer outside its theme unless the row says it is a probe', () => {
    const mismatch = row({ layers: ['fantasy-spell'], features: ['places'] })
    expect(check([mismatch])[0]).toMatch(/fits fantasy, not daily/)
    expect(check([{ ...mismatch, probe: ['fantasy-spell'] }])).toEqual([])
    expect(check([{ ...mismatch, probe: ['dice'] }]).join(' ')).toMatch(/probe names dice/)
  })

  it('refuses a script in the wrong language, with an unknown expectation or one that names someone not in the row', () => {
    const script = (extra: Partial<Script> = {}): Script => ({ id: 's', language: 'en', turns: [{ say: 'Hello.', expect: [{ type: 'narration-clean' }] }], expect: [], ...extra })
    const run = (made: Script): string[] => { write('scripts/s.json', made); return check([row({ script: 's' })]) }
    expect(run(script())).toEqual([])
    expect(run(script({ language: 'zh' }))[0]).toMatch(/written in zh/)
    expect(run(script({ turns: [] }))[0]).toMatch(/no turns/)
    expect(run(script({ turns: [{ say: ' ', expect: [] }] }))[0]).toMatch(/says nothing/)
    expect(run(script({ expect: [{ type: 'mind-reading' } as never] }))[0]).toMatch(/not in the vocabulary/)
    expect(run(script({ expect: [{ type: 'speaks', character: 'zed' }] }))[0]).toMatch(/names zed/)
    expect(run(script({ expect: [{ type: 'character-silent', character: 'zed' }] }))[0]).toMatch(/names zed/)
    expect(run(script({ turns: [{ say: 'Hi.', expect: [{ type: 'character-doing', character: 'bob', text: 'sleeps' }] }] }))[0]).toMatch(/about the whole story/)
  })

  it('refuses a script that is not there, and an exclusion without a reason or with an unknown feature', () => {
    expect(check([row({ script: 'nothing' })])[0]).toMatch(/script nothing does not exist/)
    expect(check([row()], [{ where: 'daily', features: ['dice'], reason: '' }])[0]).toMatch(/gives no reason/)
    expect(check([row()], [{ where: 'daily', features: ['magic'], reason: 'x' }])[0]).toMatch(/unknown feature magic/)
  })
})

describe('the coverage report', () => {
  it('lists a feature seen in one theme as a gap, excuses what the data excuses, and shows the cast tiers', () => {
    write('rows/rows.json', [row()])
    write('excluded.json', [{ where: 'any', features: ['dice'], reason: 'no dice in the tiny world' }])
    const report = coverage(loadData(root))
    expect(report.gaps.find(gap => gap.what === 'places')?.missing).toMatch(/seen in 1 theme/)
    expect(report.gaps.find(gap => gap.what === 'dice')).toMatchObject({ excused: 'no dice in the tiny world' })
    expect(report.casts).toEqual({ daily: ['solo'] })
    expect(describeCoverage(report)).toContain('Gaps (')
  })
})

describe('judging what a run saw', () => {
  const script: Script = { id: 's', language: 'en', turns: [{ say: 'Hi.', expect: [{ type: 'narration-clean' }, { type: 'speaks', character: 'bob' }] }, { say: 'Again.', expect: [{ type: 'narration-lacks', text: 'the key' }] }], expect: [{ type: 'player-silent' }, { type: 'character-exists', character: 'bob' }, { type: 'turns', count: 2 }] }
  const seen = (...texts: string[]) => texts.map(text => ({ segments: [{ type: 'narration' as const, text }, { type: 'utterance' as const, character: 'bob', name: 'Bob', text: 'Hello there.' }] }))

  it('holds each expectation to its own turn and the story ones to the whole story', () => {
    const verdicts = evaluate(script, { language: 'en', player: 'ann', turns: seen('It rains.', 'Bob nods.'), characters: [{ key: 'bob', placed: true }], places: true })
    expect(verdicts.map(verdict => verdict.held)).toEqual([true, true, true, true, true, true])
  })

  it('finds a panel, a leak, the player given words and a character in no place, and says where', () => {
    const turns = seen('It rains.\n```\nHP: 12 | Gold: 40\n```', 'Bob hides the key. "Take the key."')
    turns[1]!.segments.push({ type: 'utterance', character: 'ann', name: 'Ann', text: 'I will.' })
    const verdicts = evaluate(script, { language: 'en', player: 'ann', turns, characters: [{ key: 'bob', placed: false }], places: true })
    expect(verdicts.filter(verdict => verdict.held === false).map(verdict => `${verdict.where}: ${verdict.expectation.type}`)).toEqual(['turn 1: narration-clean', 'turn 2: narration-lacks', 'story: player-silent', 'story: character-exists'])
  })

  it('reports an unplayed turn and an unreadable story as not judged, never as held', () => {
    const verdicts = evaluate(script, { language: 'en', player: 'ann', turns: seen('It rains.') })
    expect(verdicts.filter(verdict => verdict.held === undefined).map(verdict => verdict.where)).toEqual(['turn 2', 'story'])
    expect(held([{ where: 'x', expectation: { type: 'narration-clean' }, held: undefined }])).toBeUndefined()
  })
})

describe('judging sleepers and who stays silent', () => {
  const script: Script = { id: 's', language: 'en', turns: [{ say: 'I whisper to Bob.', expect: [{ type: 'character-silent', character: 'bob' }] }], expect: [
    { type: 'character-silent', character: 'bob' }, { type: 'character-doing', character: 'bob', text: 'sleep' }, { type: 'character-doing', character: 'cy', text: 'sleep', not: true }] }
  const quiet = [{ segments: [{ type: 'narration' as const, text: 'Bob does not stir.' }] }]
  const observation = { language: 'en' as const, player: 'ann', turns: quiet, characters: [{ key: 'bob', placed: true, activity: 'Sleeps soundly' }, { key: 'cy', placed: true, activity: 'wakes with a start' }] }

  it('holds a character to silence in a turn and in the story, and reads what the story says it is doing', () => {
    expect(evaluate(script, observation).map(verdict => verdict.held)).toEqual([true, true, true, true])
  })

  it('finds a sleeper that spoke, and one that did not wake', () => {
    const spoke = [{ segments: [{ type: 'utterance' as const, character: 'bob', name: 'Bob', text: 'Who is there?' }] }]
    const verdicts = evaluate(script, { ...observation, turns: spoke, characters: [{ key: 'bob', placed: true, activity: 'wakes up' }, { key: 'cy', placed: true, activity: 'sleeps' }] })
    expect(verdicts.filter(verdict => verdict.held === false).map(verdict => `${verdict.where}: ${verdict.expectation.type}`)).toEqual(['turn 1: character-silent', 'story: character-silent', 'story: character-doing', 'story: character-doing'])
  })

  it('does not judge what the run could not read', () => {
    const { characters: _c, ...bare } = observation
    expect(evaluate(script, bare).map(verdict => verdict.held)).toEqual([true, true, undefined, undefined])
  })
})

describe('a character that is not at a place', () => {
  const observation = { language: 'en' as const, player: 'ann', turns: [], characters: [{ key: 'bob', placed: true, place: 'yard' }] }
  const verdict = (place: string, not?: boolean) => evaluate({ id: 's', language: 'en', turns: [], expect: [{ type: 'character-at', character: 'bob', place, ...not === undefined ? {} : { not } }] }, observation)[0]!.held
  it('holds when the character stands elsewhere, and fails when it stands there', () => {
    expect(verdict('home', true)).toBe(true)
    expect(verdict('yard', true)).toBe(false)
    expect(verdict('yard')).toBe(true)
  })
})

describe('judging the story\'s state', () => {
  const script: Script = { id: 's', language: 'en', turns: [], expect: [
    { type: 'value-changed', name: 'Weather' }, { type: 'value-changed', name: 'Fatigue', of: 'bob' }, { type: 'value-is', name: 'Weather', value: 'rain' },
    { type: 'trigger-fired', key: 'bell' }, { type: 'character-at', character: 'bob', place: 'home' }, { type: 'item-held-by', item: 'key', holder: 'ann' }, { type: 'cast-grew', by: 1 }] }
  const observation = {
    language: 'en' as const, player: 'ann', turns: [], castAtStart: 2,
    characters: [{ key: 'ann', placed: true, place: 'home' }, { key: 'bob', placed: true, place: 'yard' }, { key: 'cy', placed: true, place: 'home' }],
    things: [{ key: 'key', holder: 'ann' }], triggers: [{ key: 'bell', fired: true }],
    initialValues: [{ of: ['world'], name: 'Weather', value: 'fog' }, { of: ['person', 'bob', 'Bob'], name: 'Fatigue', value: '2' }],
    values: [{ of: ['world'], name: 'Weather', value: 'rain' }, { of: ['person', 'bob', 'Bob'], name: 'Fatigue', value: '2' }],
  }

  it('reads values, triggers, places, things and the made-up cast from what the run saw', () => {
    expect(evaluate(script, observation).map(verdict => verdict.held)).toEqual([true, false, true, true, false, true, true])
  })

  it('does not judge what the run could not read', () => {
    const { characters: _c, things: _t, triggers: _r, values: _v, initialValues: _i, ...bare } = observation
    expect(evaluate(script, bare).map(verdict => verdict.held)).toEqual(Array(7).fill(undefined))
  })
})

describe('what the data validation refuses in the new script features', () => {
  const check = (made: Script, rowExtra: Partial<Row> = {}): string[] => { write('scripts/s.json', made); write('rows/rows.json', [row({ script: 's', ...rowExtra })]); write('excluded.json', []); return validateData(loadData(root)) }
  const script = (extra: Partial<Script> = {}): Script => ({ id: 's', language: 'en', turns: [{ say: 'Hi.', expect: [] }, { say: 'Again.', expect: [] }], expect: [], ...extra })

  it('refuses an action that says something, a rewind to a turn that is not before it and a story expectation inside a turn', () => {
    expect(check(script({ turns: [{ say: 'Hi.', action: 'regenerate', expect: [] }] }))[0]).toMatch(/either say something or take an action/)
    expect(check(script({ turns: [{ say: 'Hi.', expect: [] }, { action: 'rewind', to: 1, expect: [] }] }))[0]).toMatch(/not before it/)
    expect(check(script({ turns: [{ say: 'Hi.', expect: [{ type: 'turns', count: 1 }] }] }))[0]).toMatch(/about the whole story/)
    expect(check(script({ turns: [{ say: 'Hi.', expect: [] }, { action: 'rewind', to: 0, expect: [] }, { action: 'regenerate', expect: [] }] }))).toEqual([])
  })

  it('refuses a thing, place or trigger the world does not have, unacceptable settings and a plant its script cannot see', () => {
    expect(check(script({ expect: [{ type: 'character-at', character: 'ann', place: 'moon' }] }))[0]).toMatch(/place moon/)
    expect(check(script({ expect: [{ type: 'trigger-fired', key: 'nope' }] }))[0]).toMatch(/trigger nope/)
    expect(check(script(), { settings: { maxRounds: 99 } })[0]).toMatch(/settings are not acceptable/)
    expect(check(script(), { plant: { what: 'a leak', caught: ['narration-lacks'] } }).join(' ')).toMatch(/narration-lacks, which its script does not expect/)
  })
})

describe('repeated sentences', () => {
  const say = (...texts: string[]) => texts.map(text => ({ segments: [{ type: 'narration' as const, text }] }))
  const script: Script = { id: 's', language: 'en', turns: [], expect: [{ type: 'no-repeats' }] }

  it('finds a sentence delivered twice across turns, and ignores short ones', () => {
    expect(evaluate(script, { language: 'en', player: 'ann', turns: say('Rain taps the glass. Bob nods.', 'Bob nods. Rain taps the glass softly.') })[0]).toMatchObject({ held: true })
    expect(evaluate(script, { language: 'en', player: 'ann', turns: say('Rain taps the glass. Bob nods.', 'The rain taps the glass. Rain taps the glass.') })[0]).toMatchObject({ held: false, found: 'Rain taps the glass.' })
  })
})

describe('speaking in voice', () => {
  const script: Script = { id: 's', language: 'en', turns: [], expect: [{ type: 'speaks-in-voice', character: 'bob' }, { type: 'speaks-in-voice', character: 'bob', share: 0.9 }] }
  const observe = (voice?: { character: string; lines: number; fits: number }[]) => evaluate(script, { language: 'en', player: 'ann', turns: [], ...voice === undefined ? {} : { voice } })

  it('holds from the share of lines the decision model found in voice, 0.7 unless the expectation says', () => {
    expect(observe([{ character: 'bob', lines: 10, fits: 8 }])).toMatchObject([{ held: true, found: '8 of 10 lines' }, { held: false }])
  })

  it('is not judged without a decision model, or when the character never spoke', () => {
    expect(observe().map(verdict => verdict.held)).toEqual([undefined, undefined])
    expect(observe([{ character: 'bob', lines: 0, fits: 0 }]).map(verdict => verdict.held)).toEqual([undefined, undefined])
  })
})

describe('messages while away and files in folders', () => {
  const script: Script = { id: 's', language: 'en', turns: [], expect: [
    { type: 'message-arrived' }, { type: 'message-arrived', character: 'bob' }, { type: 'message-arrived', character: 'ann' },
    { type: 'file-exists', in: 'workspace', name: 'a.txt' }, { type: 'file-lacks', in: 'outside', name: 'b.txt' }, { type: 'file-exists', in: 'given', name: 'c.txt' }] }
  const seen = { language: 'en' as const, player: 'ann', turns: [], characters: [{ key: 'bob', name: 'Bob', placed: true }, { key: 'ann', name: 'Ann', placed: true }], notes: [{ kind: 'suggestions', lines: ['x'] }, { kind: 'message', lines: ['Bob: Come by later.'] }], files: { workspace: ['a.txt'], outside: ['b.txt'], given: [] } }

  it('finds a message from a named or any character, and a file that is or is not in a folder', () => {
    expect(evaluate(script, seen).map(verdict => verdict.held)).toEqual([true, true, false, true, false, false])
  })

  it('does not judge what it could not read', () => {
    const { notes: _n, files: _f, ...bare } = seen
    expect(evaluate(script, bare).map(verdict => verdict.held)).toEqual(Array(6).fill(undefined))
  })
})

describe('what the data validation refuses in waits, folders and their tokens', () => {
  const check = (made: Script, rowExtra: Partial<Row> = {}): string[] => { write('scripts/s.json', made); write('rows/rows.json', [row({ script: 's', ...rowExtra })]); write('excluded.json', []); return validateData(loadData(root)) }
  const script = (extra: Partial<Script> = {}): Script => ({ id: 's', language: 'en', turns: [{ say: 'Hi.', expect: [] }], expect: [], ...extra })

  it('refuses a wait that is not 1 to 240 whole minutes or that expects something', () => {
    expect(check(script({ turns: [{ say: 'Hi.', expect: [] }, { action: 'wait', minutes: 15, expect: [] }] }))).toEqual([])
    expect(check(script({ turns: [{ say: 'Hi.', expect: [] }, { action: 'wait', minutes: 0, expect: [] }] }))[0]).toMatch(/whole number of minutes/)
    expect(check(script({ turns: [{ say: 'Hi.', expect: [] }, { action: 'wait', minutes: 5, expect: [{ type: 'narration-clean' }] }] }))[0]).toMatch(/delivers nothing/)
  })

  it('refuses a folder or a token the row does not have, and bad folder names', () => {
    const folders = { folders: [{ name: 'notes', access: 'read' as const }] }
    expect(check(script({ turns: [{ say: 'Write to {folder:notes} and {workspace} and {outside}.', expect: [] }], expect: [{ type: 'file-exists', in: 'notes', name: 'a' }] }), folders)).toEqual([])
    expect(check(script({ turns: [{ say: 'Write to {folder:other}.', expect: [] }] }), folders)[0]).toMatch(/\{folder:other\}/)
    expect(check(script({ turns: [{ say: 'Write to {desk}.', expect: [] }] }), folders)[0]).toMatch(/\{desk\}/)
    expect(check(script({ expect: [{ type: 'file-exists', in: 'other', name: 'a' }] }), folders)[0]).toMatch(/looks in "other"/)
    expect(check(script(), { folders: [{ name: 'Bad Name', access: 'read' }] })[0]).toMatch(/folder name "Bad Name"/)
    expect(check(script(), { folders: [{ name: 'a', access: 'read' }, { name: 'a', access: 'write' }] })[0]).toMatch(/used twice/)
  })
})

describe('judging the text of files and a page', () => {
  const page = '<!doctype html><html><head><title>Rye &amp; Ember</title><link rel="stylesheet" href="style.css"></head><body><h1>Rye</h1><a href="https://example.test/x">x</a><a href="#menu">menu</a><img src="./logo.png"></body></html>'
  const script: Script = { id: 's', language: 'en', turns: [], expect: [
    { type: 'file-has', in: 'site', name: 'index.html', text: 'RYE' }, { type: 'file-has', in: 'site', name: 'index.html', text: 'contact' }, { type: 'file-has', in: 'site', name: 'none.html', text: 'x' },
    { type: 'html-sane', in: 'site', name: 'index.html' }, { type: 'html-sane', in: 'bare', name: 'index.html' }, { type: 'html-sane', in: 'site', name: 'none.html' }] }
  const seen = (files: string[]) => ({ language: 'en' as const, player: 'ann', turns: [], files: { site: files, bare: ['index.html'] }, fileTexts: { site: { 'index.html': page }, bare: { 'index.html': '<html><body>no title</body></html>' } } })

  it('finds text in a file, and a page that has a title, a body, a close and every local file it names', () => {
    expect(evaluate(script, seen(['index.html', 'style.css', 'logo.png'])).map(verdict => verdict.held)).toEqual([true, false, false, true, false, false])
  })

  it('names what a page lacks, and does not judge what was not read', () => {
    const verdict = evaluate(script, seen(['index.html']))[3]!
    expect(verdict).toMatchObject({ held: false, found: expect.stringContaining('style.css') })
    expect(verdict.found).toContain('logo.png')
    expect(evaluate(script, { language: 'en', player: 'ann', turns: [] }).map(entry => entry.held)).toEqual(Array(6).fill(undefined))
  })
})

describe('judging the made-up cast', () => {
  const script: Script = { id: 's', language: 'en', turns: [], expect: [{ type: 'cast-distinct' }, { type: 'cast-placed' }] }
  const seen = (names: [string, boolean][], places = true) => ({ language: 'en' as const, player: 'ann', turns: [], places, characters: names.map(([name, placed]) => ({ key: name.toLowerCase(), name, placed })) })

  it('finds a name used twice (case aside) and a character in no place', () => {
    expect(evaluate(script, seen([['Ann', true], ['Bob', true]])).map(verdict => verdict.held)).toEqual([true, true])
    const bad = evaluate(script, seen([['Ann', true], ['ann', false]]))
    expect(bad.map(verdict => verdict.held)).toEqual([false, false])
    expect(bad[0]).toMatchObject({ found: 'more than one ann' })
    expect(bad[1]).toMatchObject({ found: 'in no place: ann' })
  })

  it('counts everyone as placed in a world with no places, and does not judge what it could not read', () => {
    expect(evaluate(script, seen([['Ann', false]], false))[1]).toMatchObject({ held: true })
    expect(evaluate(script, { language: 'en', player: 'ann', turns: [] }).map(verdict => verdict.held)).toEqual([undefined, undefined])
  })
})

describe('worlds taken from existing fiction', () => {
  const check = (meta: Record<string, unknown>): string[] => { write('worlds/tiny/bench.json', { id: 'tiny', name: 'Tiny', purpose: 'x', languages: { en: { native: true } }, ...meta }); write('rows/rows.json', [row()]); write('excluded.json', []); return validateData(loadData(root)) }

  it('must say what they are derived from, that it is public domain or licensed, and what was invented', () => {
    expect(check({ theme: 'fan' })[0]).toMatch(/derived from existing fiction/)
    expect(check({ theme: 'fan', source: { derivedFrom: 'A novel', note: 'invented' } })[0]).toMatch(/derived from existing fiction/)
    expect(check({ theme: 'fan', source: { derivedFrom: 'A novel (public domain)', note: '' } })[0]).toMatch(/derived from existing fiction/)
    expect(check({ theme: 'fan', source: { derivedFrom: 'A novel (public domain)', note: 'Every fact here is invented.' } })).toEqual([])
    expect(check({ theme: 'daily' })).toEqual([])
  })
})

describe('the commands a script writes', () => {
  const run = (say: string, extra: Partial<Row> = {}, expect: Script['turns'][number]['expect'] = [{ type: 'narration-clean' }]): string[] => {
    write('scripts/s.json', { id: 's', language: 'en', turns: [{ say, expect }], expect: [] } satisfies Script)
    write('rows/rows.json', [row({ script: 's', ...extra })])
    write('excluded.json', [])
    return validateData(loadData(root))
  }

  it('may be the five every story has, with what each needs', () => {
    for (const line of ['/ooc Bob goes home', '/ask who is here', '/roll 2d6 pick the lock', '/wait 2 hours', '/dream', 'I say /ooc to Bob']) expect(run(line)).toEqual([])
  })

  it('are refused when the row\'s world does not have the command, the name is not one DSH takes, or the arguments are refused at once', () => {
    expect(run('/recruit a juggler')[0]).toMatch(/\/recruit is no command of this row/)
    expect(run('/招募 找人', { layers: ['commands'] })[0]).toMatch(/not a name DSH takes/)
    expect(run('/ooc')[0]).toMatch(/nothing after it/)
    expect(run('/roll')[0]).toMatch(/no dice/)
    expect(run('/wait a while')[0]).toMatch(/no time DSH can read/)
  })

  it('may be a command of the world: by its word, or by the key of its flag when the word is not a name DSH takes', () => {
    expect(run('/recruit a juggler', { layers: ['commands'] })).toEqual([])
    expect(run('/zhaomu 找人', { layers: ['commands'] })).toEqual([])
  })

  it('may be typed as text on purpose when the row says so, which is how a control without the command is played', () => {
    expect(run('/recruit a juggler', { typedAsText: ['recruit'] })).toEqual([])
  })
})

describe('judging that a line ran as a command', () => {
  const script: Script = { id: 's', language: 'en', turns: [{ say: '/ooc Bob goes home', expect: [{ type: 'command-ruled' }] }, { say: '/ask who?', expect: [{ type: 'command-ruled', question: true }] }, { say: 'I nod.', expect: [{ type: 'command-ruled' }] }], expect: [] }
  const segments = [{ type: 'narration' as const, text: 'Bob goes.' }]

  it('holds when the turn carries a ruling, of the kind asked for, and fails for a move or the other kind', () => {
    const verdicts = evaluate(script, { language: 'en', player: 'ann', turns: [], played: [{ segments, ooc: { legal: true } }, { segments, ooc: { legal: true } }, { segments }] })
    expect(verdicts.map(verdict => verdict.held)).toEqual([true, false, false])
    expect(verdicts[1]!.found).toMatch(/other kind/)
    expect(verdicts[2]!.found).toMatch(/played as a move/)
    expect(evaluate(script, { language: 'en', player: 'ann', turns: [], played: [{ segments, ooc: { legal: true } }, { segments, ooc: { legal: true, question: true } }, { segments }] })[1]!.held).toBe(true)
  })

  it('at the end of a script means that some turn of the story was ruled on', () => {
    const ended: Script = { id: 's', language: 'en', turns: [], expect: [{ type: 'command-ruled' }] }
    expect(evaluate(ended, { language: 'en', player: 'ann', turns: [{ segments }, { segments, ooc: { legal: false } }] })[0]!.held).toBe(true)
    expect(evaluate(ended, { language: 'en', player: 'ann', turns: [{ segments }] })[0]!.held).toBe(false)
  })
})

describe('what the player reads of an out-of-character answer', () => {
  const asked: Script = { id: 's', language: 'en', turns: [{ say: '/ask who is here?', expect: [{ type: 'narration-has', text: 'Tomas' }, { type: 'narration-lacks', text: 'brandy' }, { type: 'narration-clean' }] }], expect: [] }

  it('is its note too: the answer to a question is nowhere else, so a leak or a missing name is found there', () => {
    const turn = (note: string) => ({ language: 'en' as const, player: 'ann', turns: [], played: [{ segments: [], ooc: { legal: true, note, question: true } }] })
    expect(evaluate(asked, turn('Tomas is at the bar.')).map(verdict => verdict.held)).toEqual([true, true, true])
    expect(evaluate(asked, turn('Nobody you know.')).map(verdict => verdict.held)).toEqual([false, true, true])
    expect(evaluate(asked, turn('Tomas hides brandy.')).map(verdict => verdict.held)).toEqual([true, false, true])
    expect(evaluate(asked, turn('Tomas.\n```\nHP: 12 | Gold: 40\n```')).map(verdict => verdict.held)).toEqual([true, true, false])
  })
})

describe('judging what a command made of its turn', () => {
  const script: Script = { id: 's', language: 'en', turns: [{ say: '/wait 2 hours', expect: [{ type: 'scene-has', section: 'wait' }] }, { say: '/roll 2d6', expect: [{ type: 'scene-has', section: 'roll' }] }], expect: [] }
  const segments = [{ type: 'narration' as const, text: 'Time passes.' }]

  it('holds when the game master was given the section, fails with the sections it was given when not, and is not judged when the turn\'s scene was not read', () => {
    const verdicts = evaluate(script, { language: 'en', player: 'ann', turns: [], played: [{ segments, scene: ['time', 'wait'] }, { segments, scene: ['time', 'rules'] }] })
    expect(verdicts.map(verdict => verdict.held)).toEqual([true, false])
    expect(verdicts[1]!.found).toBe('time, rules')
    expect(evaluate(script, { language: 'en', player: 'ann', turns: [], played: [{ segments }, { segments }] }).map(verdict => verdict.held)).toEqual([undefined, undefined])
  })

  it('is refused at the end of a script, and for a section that no command makes', () => {
    const run = (turns: Script['turns'], end: Script['expect'] = []): string[] => {
      write('scripts/s.json', { id: 's', language: 'en', turns, expect: end } satisfies Script)
      write('rows/rows.json', [row({ script: 's' })])
      write('excluded.json', [])
      return validateData(loadData(root))
    }
    expect(run([{ say: '/wait 2 hours', expect: [{ type: 'scene-has', section: 'wait' }] }])).toEqual([])
    expect(run([{ say: 'Hi.', expect: [] }], [{ type: 'scene-has', section: 'wait' }])[0]).toMatch(/about one turn/)
    expect(run([{ say: '/wait 2 hours', expect: [{ type: 'scene-has', section: 'weather' as never }] }])[0]).toMatch(/not one of roll, wait, dream and command/)
  })
})
