// node --test eval/audit.test.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { audit, evidenceFrom, instructionFor, loadCriteria, parseJudgement, parseScope, render, scoreOf } from './audit.mjs'

const dimensions = loadCriteria()
const consistency = dimensions.find(dimension => dimension.id === 'consistency')

let folder
let database
let server
let url
let replies = []
before(async () => {
  folder = mkdtempSync(join(tmpdir(), 'audit-'))
  database = join(folder, 'session.sqlite')
  const db = new DatabaseSync(database)
  db.exec(`
    CREATE TABLE characters (id INTEGER PRIMARY KEY, name TEXT, role TEXT, summary TEXT, personality TEXT, speech_style TEXT);
    CREATE TABLE events (id INTEGER PRIMARY KEY, turn INTEGER, round INTEGER, text TEXT, importance INTEGER);
    CREATE TABLE event_involves (event_id INTEGER, character_id INTEGER);
    CREATE TABLE perceptions (id INTEGER PRIMARY KEY, event_id INTEGER, character_id INTEGER, mode TEXT, content TEXT, accuracy TEXT);
    INSERT INTO characters VALUES (1, 'Arthur', 'playable', 'A clerk', 'careful', 'dry'), (2, 'Clara', 'npc', 'A guard', 'blunt', 'short');
    INSERT INTO events VALUES (1, 1, 1, 'Clara locked the cellar door.', 3), (2, 2, 1, 'Arthur walked through the cellar door.', 3), (3, 3, 1, 'Clara slept.', 1);
    INSERT INTO event_involves VALUES (1, 2), (2, 1), (3, 2);
    INSERT INTO perceptions VALUES (1, 1, 2, 'witnessed', 'I locked the door.', 'accurate');
  `)
  db.close()
  server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: replies.shift() ?? '{"abstain": true, "reason": "none"}' } }] }))
    })
  }).listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  url = `http://127.0.0.1:${server.address().port}/v1`
})
after(() => { server.close(); rmSync(folder, { recursive: true, force: true }) })

describe('scoring', () => {
  it('takes the penalty of each named error with a record, never below 0, and nothing for what is not on the list', () => {
    const found = [{ error: 'contradiction', record: 2, quote: 'x' }, { error: 'fabrication', record: 3 }, { error: 'taste', record: 1 }, { error: 'timeline' }]
    assert.equal(scoreOf(consistency, { errors: found }).score, 75)
    assert.equal(scoreOf(consistency, { errors: Array.from({ length: 10 }, () => ({ error: 'contradiction', record: 1 })) }).score, 0)
    assert.equal(scoreOf(consistency, { errors: [] }).score, 100)
  })

  it('has no score when the judge abstains or answers nothing usable', () => {
    assert.equal(scoreOf(consistency, { abstain: true, reason: 'too little' }).score, null)
    assert.equal(scoreOf(consistency, undefined).score, null)
  })
})

describe('reading a judgement', () => {
  it('finds the JSON after reasoning and a fence', () => {
    assert.deepEqual(parseJudgement('<think>hmm {x}</think>\n```json\n{"abstain": true}\n```'), { abstain: true })
    assert.equal(parseJudgement('no answer'), undefined)
    assert.equal(parseJudgement('{broken'), undefined)
  })
})

describe('scope and evidence', () => {
  it('parses the scopes and refuses others', () => {
    assert.deepEqual(parseScope(), { kind: 'story' })
    assert.deepEqual(parseScope('character:Clara'), { kind: 'character', name: 'Clara' })
    assert.deepEqual(parseScope('turn:3'), { kind: 'turn', turn: 3 })
    assert.throws(() => parseScope('turn:x'))
    assert.throws(() => parseScope('everything'))
  })

  it('shows a character only what it took part in or perceived, and what it perceived apart', () => {
    const evidence = evidenceFrom(database, parseScope('character:clara'))
    assert.equal(evidence.count, 2)
    assert.match(render(evidence, parseScope('character:clara')), /Clara witnessed: I locked the door\./)
    assert.ok(!render(evidence, parseScope('character:clara')).includes('Arthur walked'))
    assert.throws(() => evidenceFrom(database, parseScope('character:Nobody')), /no character/)
  })

  it('leaves out the oldest records first when there is too much', () => {
    const text = render(evidenceFrom(database, parseScope('story')), parseScope('story'), 10)
    assert.match(text, /left out/)
    assert.match(text, /Clara slept/)
  })

  it('asks for errors from the list only, with evidence, and allows abstaining', () => {
    const text = instructionFor(consistency, parseScope('story'))
    assert.match(text, /contradiction/)
    assert.match(text, /abstain/)
  })
})

describe('an audit', () => {
  it('scores each dimension from what the judge found and skips character dimensions for the whole story', async () => {
    replies = ['{"abstain": false, "errors": [{"error": "contradiction", "record": 2, "quote": "walked through", "note": "the door was locked"}]}', '{"abstain": false, "errors": []}']
    const report = await audit({ database, scope: parseScope('story'), dimensions, judge: { url, model: 'm' } })
    assert.equal(report.dimensions.consistency.score, 85)
    assert.equal(report.dimensions.variety.score, 100)
    assert.equal(report.dimensions.memory, undefined)
  })

  it('has no score for a scope with nothing in it', async () => {
    const report = await audit({ database, scope: parseScope('turn:9'), dimensions, judge: { url, model: 'm' } })
    assert.equal(report.dimensions.consistency.score, null)
  })
})
