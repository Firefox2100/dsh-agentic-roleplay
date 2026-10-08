import { describe, expect, it } from 'vitest'
import { parseLoreFile } from '../../../src/host/lore/lore-file.ts'

describe('lore.json', () => {
  it('reads canonical lore with links, provenance and validity', () => {
    const result = parseLoreFile(JSON.stringify({ title: 'The founding', kind: 'history', summary: 'Founded by the river.', body: 'A longer account.', subjects: [{ kind: 'location', id: 'blackwater' }], related: ['bell-custom'], sources: ['parish register'], starts_at: '1764-01-01' }), 'founding')
    expect(result).toMatchObject({ ok: true, value: { id: 'founding', kind: 'history', subjects: [{ kind: 'location', id: 'blackwater' }], related: ['bell-custom'], sources: ['parish register'] } })
  })

  it('reports invalid dates and subject kinds', () => {
    const result = parseLoreFile(JSON.stringify({ title: 'Bad', subjects: [{ kind: 'planet', id: 'mars' }], starts_at: 'sometime' }), 'bad')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.map(issue => issue.path)).toEqual(expect.arrayContaining(['subjects[0].kind', 'starts_at']))
  })
})
