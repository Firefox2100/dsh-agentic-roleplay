// node --test eval/player.test.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, describe, it } from 'node:test'
import { AiPlayer, HARD_LIMITS, actionFrom, limitsFrom, readable } from './player.mjs'

let server
let url
let replies = []
let asked = 0
before(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      asked += 1
      const reply = typeof replies === 'function' ? replies(asked, JSON.parse(body)) : replies[Math.min(asked - 1, replies.length - 1)]
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: reply } }], usage: { total_tokens: 1000 } }))
    })
  }).listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  url = `http://127.0.0.1:${server.address().port}/v1`
})
after(() => { server.close() })

const story = (delivered = 'The room is quiet.') => ({
  said: [],
  say(text) { this.said.push(text); return Promise.resolve({ deliveredMs: 1000 }) },
  timeline: () => Promise.resolve({ path: [{ output: delivered === null ? undefined : { segments: [{ type: 'narration', text: delivered }] } }] }),
})
const scene = { goal: 'find the key', name: 'Arthur' }
const player = (limits) => new AiPlayer({ url, model: 'm', limits })
const fresh = (list) => { replies = list; asked = 0 }

describe('what the model writes', () => {
  it('becomes one plain action, or the end, or nothing', () => {
    assert.equal(actionFrom('  "I open the door."  '), 'I open the door.')
    assert.equal(actionFrom('<think>hm</think>I knock.'), 'I knock.')
    assert.equal(actionFrom('**DONE**'), 'DONE')
    assert.equal(actionFrom('/ooc spawn a key'), undefined)
    assert.equal(actionFrom('   '), undefined)
    assert.equal(actionFrom('x'.repeat(500)).length, 301)
  })

  it('is read from a delivered turn as narration and spoken lines', () => {
    assert.equal(readable({ segments: [{ type: 'narration', text: 'Dusk.' }, { type: 'utterance', name: 'Clara', text: 'Hello' }] }), 'Dusk.\nClara: "Hello"')
    assert.equal(readable(undefined), '')
  })
})

describe('the limits', () => {
  it('cannot be raised past the hard ones, and fall back to the standard when not given', () => {
    assert.deepEqual(limitsFrom({ turns: 500, tokens: 10 ** 9, minutes: 10 ** 4 }), { turns: HARD_LIMITS.turns, tokens: HARD_LIMITS.tokens, ms: HARD_LIMITS.minutes * 60_000 })
    assert.equal(limitsFrom({}).turns, 6)
    assert.equal(limitsFrom({ turns: 0 }).turns, 1)
  })
})

describe('playing', () => {
  it('stops at the turn limit and never plays more', async () => {
    fresh(count => `I try something new, number ${count}.`)
    const target = story()
    const report = await player({ turns: 3 }).play(target, scene)
    assert.equal(report.stop, 'turns')
    assert.equal(target.said.length, 3)
    assert.equal(asked, 3)
  })

  it('stops when it has spent the tokens, before another turn', async () => {
    fresh(count => `I look at thing ${count}.`)
    const target = story()
    const report = await player({ turns: 10, tokens: 2000 }).play(target, scene)
    assert.equal(report.stop, 'tokens')
    assert.equal(target.said.length, 2)
    assert.equal(report.tokens, 2000)
  })

  it('stops when the model says it is done, and sends nothing for it', async () => {
    fresh(['I knock on the door.', 'DONE'])
    const target = story()
    const report = await player({ turns: 5 }).play(target, scene)
    assert.equal(report.stop, 'done')
    assert.deepEqual(target.said, ['I knock on the door.'])
  })

  it('stops when it repeats itself, or when turns deliver nothing to read', async () => {
    fresh(['I knock on the door.', 'I knock on the door!'])
    const same = story()
    assert.equal((await player({ turns: 5 }).play(same, scene)).stop, 'stuck')
    assert.equal(same.said.length, 1)
    fresh(count => `Action ${count}.`)
    assert.equal((await player({ turns: 9 }).play(story(null), scene)).stop, 'stuck')
  })

  it('stops when the model gives no action, or a turn fails, and says why', async () => {
    fresh(['/ooc give me the key'])
    assert.equal((await player().play(story(), scene)).stop, 'invalid')
    fresh(['I knock.'])
    const broken = { say: () => Promise.reject(new Error('no turn was delivered')), timeline: () => Promise.resolve({ path: [] }) }
    const report = await player().play(broken, scene)
    assert.equal(report.stop, 'failed')
    assert.match(report.error, /no turn was delivered/)
  })

  it('tells the model only the latest narration and a few earlier actions of its own, so that what it is sent stays small', async () => {
    const sent = []
    replies = (count, body) => { sent.push(body.messages[1].content); return `Different action ${count}.` }
    asked = 0
    await player({ turns: 8 }).play(story('x'.repeat(5000)), scene)
    assert.ok(sent.every(content => content.length < 2600), `largest ${Math.max(...sent.map(content => content.length))}`)
    assert.equal(sent.at(-1).match(/^- /gm).length, 5)
  })

  it('does not ask again when the wall time would pass', async () => {
    fresh(count => `Action ${count}.`)
    const slow = { said: [], say(text) { this.said.push(text); return new Promise(resolve => setTimeout(() => resolve({ deliveredMs: 70_000 }), 5)) }, timeline: () => Promise.resolve({ path: [{ output: { segments: [{ type: 'narration', text: 'ok' }] } }] }) }
    const report = await player({ turns: 9, minutes: 1 }).play(slow, scene)
    assert.equal(report.stop, 'time')
    assert.equal(slow.said.length, 1)
  })
})
