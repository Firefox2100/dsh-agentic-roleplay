import { describe, expect, it, vi } from 'vitest'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
import { changedFields } from '../../../src/host/authoring/approval-summary.ts'
import { authoringApproval } from '../../../src/host/authoring/write-tools.ts'

const exec = (name: string, args: Record<string, unknown>) => ({ name, arguments: args, agent: { session: { id: authoringChatSessionId('harbor') } } }) as never
const allow = () => Promise.resolve({ kind: 'allow' as const })

describe('the question put to the person', () => {
  it('shows what a replacement changes, field by field, and keeps the short reason', async () => {
    const current = vi.fn(() => Promise.resolve({ name: 'Mara', role: 'npc', summary: 'A pilot.' }))
    const decision = await authoringApproval(exec('replace_world_element', { kind: 'character', key: 'mara', document: { name: 'Mara Quill', role: 'playable', summary: 'A pilot.', age: '30' } }), allow, undefined, { current })
    expect(decision).toMatchObject({ kind: 'ask', reason: 'edit authored world character “mara”' })
    const text = (decision as unknown as { displayReason: { en: string; zh: string } }).displayReason
    expect(text.en).toBe('Edit character “mara” in the world files: name “Mara” → “Mara Quill”; role “npc” → “playable”; +age “30”')
    expect(text.zh).toBe('编辑世界文件中的character “mara”：name “Mara” → “Mara Quill”; role “npc” → “playable”; +age “30”')
  })

  it('says what a new document is, and still asks when the old one cannot be read', async () => {
    const created = await authoringApproval(exec('create_world_element', { kind: 'location', key: 'dock', document: { name: 'Dock', description: 'Wet.' } }), allow)
    expect((created as unknown as { displayReason: { en: string } }).displayReason.en).toBe('Create location “dock” in the world files: named “Dock”, fields: name, description')
    const unreadable = await authoringApproval(exec('replace_world_element', { kind: 'location', key: 'dock', document: { name: 'Dock' } }), allow, undefined, { current: () => Promise.reject(new Error('gone')) })
    expect(unreadable).toMatchObject({ kind: 'ask' })
  })

  it('caps a long list of changes and a long value', () => {
    const before = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`f${i}`, 'a']))
    const after = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`f${i}`, 'b'.repeat(200)]))
    const text = changedFields(before, after).en
    expect(text).toContain('and 3 more')
    expect(text.length).toBeLessThan(600)
  })

  it('is not asked at all when the person chose automatic changes, but an import\'s limits stay', async () => {
    const next = vi.fn(allow)
    await expect(authoringApproval(exec('replace_world_element', { kind: 'character', key: 'mara', document: {} }), next, undefined, { auto: () => true })).resolves.toEqual({ kind: 'allow' })
    await expect(authoringApproval(exec('import_preset', {}), next, undefined, { auto: () => true })).resolves.toEqual({ kind: 'allow' })
    await expect(authoringApproval(exec('write_world_prompt', { id: 'roleplay/character-rules', language: 'en' }), next, () => Promise.resolve(true), { auto: () => true })).resolves.toMatchObject({ kind: 'deny' })
    await expect(authoringApproval(exec('replace_world_element', { kind: 'character', key: 'mara', document: {} }), next, undefined, { auto: () => false })).resolves.toMatchObject({ kind: 'ask' })
  })
})
