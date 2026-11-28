import { beforeEach, describe, expect, it } from 'vitest'
import { CONFIRM_CLAIM_TOOL, createClaimTools } from '../../../src/host/orchestration/claim-tools.ts'
import { OPTIONAL_TOOLS, toolEnabled } from '../../../src/shared/tools.ts'
import { alice, arthur, fakeStore, type FakeStore } from './fixtures.ts'

let store: FakeStore

const confirm = (args: Record<string, unknown>) => {
  const [tool] = createClaimTools({ engine: undefined as never, boundaries: undefined as never, stores: chat => (chat === 'session-1' ? store : undefined), turnOf: () => 1, delivered: undefined as never })
  return tool!.execute(args as never, { agent: { session: { id: 'session-1' } }, signal: new AbortController().signal } as never)
}

beforeEach(() => {
  store = fakeStore([arthur, alice])
  store.story.characters.add({ sourceId: 'arthur', name: 'Arthur', aliases: [], kind: 'person', tier: 'principal', role: 'playable', control: 'player', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
})

const proposeOne = () => {
  const result = store.story.edit({ turn: 1, events: [{ turn: 1, round: 1, text: 'Arthur says the cellar is flooded.', importance: 2, perceivedBy: [{ character: 'arthur', mode: 'witnessed' }] }], claims: [{ text: 'The cellar is flooded.', byCharacter: 'arthur', assertedInNew: 0 }] } as never)
  return result.claimIds![0]!
}

describe('confirming a claim as the game master', () => {
  it('is a switchable tool of the game master and on unless switched off', () => {
    expect(OPTIONAL_TOOLS).toContainEqual({ id: CONFIRM_CLAIM_TOOL, agent: 'gameMaster', default: true })
    expect(toolEnabled({}, 'gameMaster', CONFIRM_CLAIM_TOOL)).toBe(true)
    expect(toolEnabled({ gameMaster: { [CONFIRM_CLAIM_TOOL]: false } }, 'gameMaster', CONFIRM_CLAIM_TOOL)).toBe(false)
  })

  it('settles a proposed claim and puts it back', async () => {
    const id = proposeOne()
    expect(store.story.claims.get(id)?.status).toBe('proposed')
    expect(await confirm({ id })).toEqual({ id, status: 'confirmed' })
    expect(store.story.claims.get(id)?.status).toBe('confirmed')
    await confirm({ id, status: 'proposed' })
    expect(store.story.claims.get(id)?.status).toBe('proposed')
  })

  it('refuses a claim the story does not have', async () => {
    await expect(confirm({ id: 999 })).rejects.toThrow()
  })
})
