import { describe, expect, it } from 'vitest'
import { askAuthor, type AuthoringApi } from './authoring-run.ts'

const clock = () => { let time = 0; return { now: () => time, sleep: (ms: number) => { time += ms; return Promise.resolve() } } }

describe('waiting for the authoring assistant', () => {
  it('returns once a turn has ended and the assistant has been idle on two looks, and counts only the turns after the message', async () => {
    const looks = [{ turns: 3, running: false }, { turns: 3, running: true }, { turns: 4, running: true }, { turns: 4, running: false }, { turns: 4, running: true }, { turns: 5, running: false }, { turns: 5, running: false }]
    const said: string[] = []
    const api: AuthoringApi = { say: async (text) => { said.push(text) }, status: async () => looks.shift()! }
    const done = await askAuthor(api, 'add a smith', { limitMs: 600_000, pollMs: 1000, ...clock() })
    expect(said).toEqual(['add a smith'])
    expect(done.turns).toBe(2)
  })

  it('does not take an idle assistant that has ended no turn since the message for an answer, and gives up with the likely cause', async () => {
    const api: AuthoringApi = { say: async () => undefined, status: async () => ({ turns: 1, running: false }) }
    await expect(askAuthor(api, 'hi', { limitMs: 60_000, pollMs: 5000, ...clock() })).rejects.toThrow(/authoringApproval/)
  })
})
