// node --test eval/fidelity.test.mjs
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { parseTruth, scoreFidelity, snapshotOf, timingOf } from './fidelity.mjs'

const call = (callId, name, turn, args = {}) => ({ type: 'tool/call', time: 1, data: { callId, name, turn, arguments: JSON.stringify(args) } })
const result = (callId, text, isError = false) => ({ type: 'tool/result', time: 1, data: { message: { toolCallId: callId, isError, content: [{ type: 'text', text }] } } })
const outcomes = (...keys) => ({ outcomes: keys.map(character => ({ character, result: 'succeeded', summary: `${character} acts` })) })
const output = (...segments) => `The output has been delivered.\n<roleplay-output>${JSON.stringify({ segments })}</roleplay-output>`

const rows = [
  call('a', 'resolve_round', 2, outcomes('alice', 'bob')), result('a', 'Round 1 is recorded (alice, bob).\nIt is now evening.'),
  call('b', 'resolve_round', 2, outcomes('alice')), result('b', 'Error: no', true),
  call('c', 'resolve_round', 2, outcomes('alice')), result('c', 'Round 2 is recorded (alice).'),
  call('d', 'narrate', 2, {}), result('d', output({ type: 'narration', text: 'Night falls.' }, { type: 'utterance', character: 'alice', name: 'Alice', text: 'The cellar key hangs behind the counter' })),
]

const database = (setup) => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE characters (id INTEGER PRIMARY KEY, source_id TEXT, name TEXT);
    CREATE TABLE events (id INTEGER PRIMARY KEY, turn INTEGER, round INTEGER, text TEXT, importance INTEGER, tags TEXT);
    CREATE TABLE event_involves (event_id INTEGER, character_id INTEGER);
    CREATE TABLE perceptions (id INTEGER PRIMARY KEY, event_id INTEGER, character_id INTEGER, content TEXT);
    CREATE TABLE pending_commits (turn INTEGER, round INTEGER);
    CREATE TABLE story_threads (id INTEGER PRIMARY KEY, text TEXT, status TEXT);
    INSERT INTO characters VALUES (1, 'alice', 'Alice'), (2, 'bob', 'Bob'), (3, 'cara', 'Cara');`)
  setup(db)
  return db
}

describe('the decisions the game master recorded', () => {
  it('are the outcomes of each round that was recorded, not of a refused call, and the delivered utterances', () => {
    const truth = parseTruth(rows)
    assert.deepEqual(truth.rounds.map(round => [round.turn, round.round, round.outcomes.map(outcome => outcome.character)]), [[2, 1, ['alice', 'bob']], [2, 2, ['alice']]])
    assert.deepEqual(truth.utterances, [{ turn: 2, character: 'alice', text: 'The cellar key hangs behind the counter' }])
  })
})

describe('the fidelity of the memory', () => {
  const truth = parseTruth(rows)
  it('counts what no event records, what no decision explains, what covers several decisions and what was said and never kept', () => {
    const db = database((handle) => {
      handle.exec(`INSERT INTO events VALUES (1, 2, 1, 'Alice and Bob talk in the bar', 3, '["bar","inn"]'), (2, 2, 9, 'Cara sings', 2, '["inns"]');
        INSERT INTO event_involves VALUES (1, 1), (2, 3);
        INSERT INTO story_threads VALUES (1, 'Find who sent the unsigned letter', 'open'), (2, 'Find out who sent the letter unsigned', 'open'), (3, 'Open the cellar', 'open');`)
    })
    const report = scoreFidelity(truth, snapshotOf(db))
    assert.deepEqual(report.missed.map(entry => [entry.round, entry.character, entry.inTurn]), [[1, 'bob', false], [2, 'alice', true]])
    assert.deepEqual(report.spurious.map(entry => entry.id), [2])
    assert.equal(report.merged.length, 0)
    assert.equal(report.unheard.length, 1)
    assert.deepEqual(report.duplicateThreads, [[1, 2]])
    assert.deepEqual(report.duplicateEvents, [])
    assert.deepEqual(report.sameForm, [['inn', 'inns']])
    assert.equal(report.rates.missed, 2 / 3)
  })

  it('leaves out the rounds still waiting to be written: nothing is missing from them yet', () => {
    const db = database((handle) => { handle.exec("INSERT INTO pending_commits VALUES (2, 2)") })
    const report = scoreFidelity(truth, snapshotOf(db))
    assert.equal(report.waiting, 1)
    assert.deepEqual(report.missed.map(entry => [entry.round, entry.character]), [[1, 'alice'], [1, 'bob']])
  })

  it('finds events of one turn that say nearly the same', () => {
    const db = database((handle) => {
      handle.exec(`INSERT INTO events VALUES (1, 2, 1, 'Clara sets down the glass and leans against the bar listening', 3, '[]'), (2, 2, 2, 'Clara sets down the glass she was wiping and leans against the bar', 2, '[]'), (3, 2, 2, 'Bob leaves for the square', 2, '[]'), (4, 3, 1, 'Clara sets down the glass and leans against the bar listening', 3, '[]');`)
    })
    assert.deepEqual(scoreFidelity(truth, snapshotOf(db)).duplicateEvents, [[1, 2]])
  })

  it('finds everything covered when each outcome has an event of its round and the utterance is in a record', () => {
    const db = database((handle) => {
      handle.exec(`INSERT INTO events VALUES (1, 2, 1, 'Alice and Bob talk', 3, '[]'), (2, 2, 2, 'Alice says the cellar key hangs behind the counter', 3, '[]');
        INSERT INTO event_involves VALUES (1, 1), (1, 2), (2, 1);`)
    })
    const report = scoreFidelity(truth, snapshotOf(db))
    assert.deepEqual([report.missed.length, report.spurious.length, report.unheard.length], [0, 0, 0])
  })
})

describe('where a turn went', () => {
  it('counts the game master calls, its look-ups and refusals, and gives each helper to the turn it began in', () => {
    const log = [
      { type: 'turn/start', time: 0, data: { turn: 2 } }, { type: 'step/start', time: 4000, data: {} },
      { type: 'assistant/message', time: 9000, data: { usage: { inputTokens: 1000, outputTokens: 50 } } }, { type: 'assistant/message', time: 12000, data: { usage: { inputTokens: 1200, outputTokens: 70 } } },
      call('x', 'list_items', 2), call('y', 'narrate', 2), result('z', 'Error', true),
      { type: 'turn/start', time: 100000, data: { turn: 3 } },
    ]
    const [first, second] = timingOf(log, [{ start: 10000, took: 30000, calls: ['recall_my_lore', 'submit_result'] }, { start: 100500, took: 1000, calls: [] }])
    assert.deepEqual([first.turn, first.firstRequestWait, first.gameMasterCalls, first.gameMasterPulls, first.refusals, first.helpers, first.lookups], [2, 4, 2, 1, 1, 1, 1])
    assert.deepEqual([first.inputTokens, first.lastInputTokens, first.outputTokens, first.gameMasterSteps], [1000, 1200, 120, 2])
    assert.equal(second.helpers, 1)
  })
})
