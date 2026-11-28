import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import * as statePlugin from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaimNotFoundError, readSessionClaims, removeSessionClaim, setSessionClaimStatus } from '../../../src/host/sessions/claims-editor.ts'
import { SessionNotFoundError } from '../../../src/host/sessions/errors.ts'

let base: string
let ctx: Context
let fiber: { dispose(): void }
const state = () => (ctx as unknown as { roleplayState: statePlugin.RoleplayState }).roleplayState
const sessionsDir = () => join(base, 'sessions')
const deps = () => ({ state: state(), sessionsDir })

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'claims-editor-'))
  ctx = new Context()
  fiber = ctx.plugin(statePlugin as never, {} as never) as unknown as { dispose(): void }
  await new Promise(resolve => setTimeout(resolve, 20))
})
afterEach(async () => {
  fiber.dispose()
  await new Promise(resolve => setTimeout(resolve, 20))
  await rm(base, { recursive: true, force: true })
})

describe('the claims of a session, for the person who settles them', () => {
  const story = () => {
    const session = state().createSession(sessionsDir(), { name: 'Night', world: { id: 'w', name: 'W' } })
    const clara = session.characters.add({ sourceId: 'clara', name: 'Clara', aliases: [], kind: 'person', tier: 'principal', role: 'npc', control: 'agent', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
    const said = session.events.add({ turn: 1, round: 1, text: 'Clara says the fire was set.', importance: 3, tags: [], involves: [clara.id] }, []).event.id
    const proof = session.events.add({ turn: 2, round: 1, text: 'The lamp is found tipped over.', importance: 3, tags: [], involves: [] }, []).event.id
    const proposed = session.claims.add({ text: 'The fire was set.', byCharacterId: clara.id, assertedEventId: said, createdTurn: 1, links: [{ eventId: proof, bearing: 'undermines', part: '' }] })
    const settled = session.claims.add({ text: 'The street talks.', byLabel: 'the street', status: 'confirmed', createdTurn: 2 })
    return { id: session.metadata.get().id, proposed: proposed.id, settled: settled.id, said, proof }
  }

  it('lists every claim with who made it, where, what the events say of it and its links, proposed ones first', () => {
    const { id, proposed, settled, said, proof } = story()
    const { claims } = readSessionClaims(deps(), id)
    expect(claims.map(claim => [claim.id, claim.status])).toEqual([[proposed, 'proposed'], [settled, 'confirmed']])
    expect(claims[0]).toMatchObject({ by: 'Clara', verdict: 'unlikely', assertedIn: { id: said, text: 'Clara says the fire was set.' }, links: [{ event: proof, text: 'The lamp is found tipped over.', as: 'undermines', part: '' }] })
    expect(claims[1]).toMatchObject({ by: 'the street', assertedIn: null, verdict: 'unresolved' })
  })

  it('settles a claim, puts it back, and removes it', () => {
    const { id, proposed } = story()
    expect(setSessionClaimStatus(deps(), id, proposed, 'confirmed').claims.find(claim => claim.id === proposed)?.status).toBe('confirmed')
    expect(setSessionClaimStatus(deps(), id, proposed, 'proposed').claims.find(claim => claim.id === proposed)?.status).toBe('proposed')
    expect(removeSessionClaim(deps(), id, proposed).claims.map(claim => claim.id)).not.toContain(proposed)
  })

  it('says so when the session or the claim does not exist', () => {
    const { id } = story()
    expect(() => readSessionClaims(deps(), 'f7a0cc4a-9a0e-4f5d-8f3e-000000000000')).toThrow(SessionNotFoundError)
    expect(() => setSessionClaimStatus(deps(), id, 99, 'confirmed')).toThrow(ClaimNotFoundError)
    expect(() => removeSessionClaim(deps(), id, 99)).toThrow(ClaimNotFoundError)
  })
})
