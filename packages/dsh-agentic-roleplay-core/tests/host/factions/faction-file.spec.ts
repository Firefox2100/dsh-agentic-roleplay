import { describe, expect, it } from 'vitest'
import { parseFactionFile } from '../../../src/host/factions/faction-file.ts'

describe('faction files', () => {
  it('reads members, goals and typed relationships', () => {
    const parsed = parseFactionFile(JSON.stringify({ name: 'Harbour Watch', values: ['order'], members: [{ character: 'alice', role: 'officer', commitment: 0.8, public: false }], relationships: [{ to: { kind: 'faction', id: 'smugglers' }, label: 'rival', tension: 0.7 }], start: { public_state: 'Patrolling.', goals: [{ name: 'Secure the harbour', type: 'agenda', horizon: 'day', priority: 0.8, urgency: 0.6 }] } }), 'watch')
    expect(parsed).toMatchObject({ ok: true, value: { id: 'watch', members: [{ character: 'alice', role: 'officer', public: false, commitment: 0.8 }], relationships: [{ to: { kind: 'faction', id: 'smugglers' }, label: 'rival' }], start: { publicState: 'Patrolling.', goals: [{ name: 'Secure the harbour' }] } } })
  })

  it('reports malformed memberships', () => {
    const parsed = parseFactionFile(JSON.stringify({ name: 'Watch', members: [{ character: 'alice', commitment: 2 }] }), 'watch')
    expect(parsed.ok).toBe(false)
  })
})
