import { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerPackJail } from '../../../src/host/authoring/pack-jail.ts'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
import { mountAgentServices } from '../../support/mount.ts'

const WORLD = '/roots/worlds/harbor'
const agent = { session: { id: authoringChatSessionId('harbor'), header: { cwd: '/roots/worlds' } } } as never
let ctx: Context
let ran: string[]

beforeEach(async () => {
  ran = []
  ctx = new Context()
  await mountAgentServices(ctx)
  for (const name of ['read', 'write', 'edit']) {
    (ctx.get('tools') as unknown as { register(tool: unknown): void }).register(defineTool({
      name,
      description: name,
      parameters: { file_path: { type: 'string', required: true, description: 'path' }, content: { type: 'string', description: 'text' } },
      output: { schema: { type: 'json' as const }, render: () => [] },
      execute(args) { ran.push(`${name} ${(args as { file_path: string }).file_path}`); return { ok: true } as never },
    }))
  }
})
afterEach(async () => { await ctx.fiber.dispose() })

const call = (name: string, file_path: string) => (ctx.get('tools') as unknown as { execute(input: unknown): Promise<unknown> }).execute({ callId: `c-${Math.random()}` as never, name, arguments: { file_path, content: 'x' }, agent, signal: new AbortController().signal })

describe('the jail among the listeners of tools/pre-execute, in the runtime of DSH', () => {
  it('stops a path outside the packs even when a listener registered before it allows everything', async () => {
    ctx.on('tools/pre-execute', () => Promise.resolve({ kind: 'allow' as const }))
    registerPackJail(ctx, { worldDirectory: () => Promise.resolve(WORLD), reviewing: () => Promise.resolve(false) })
    const result = await call('write', '/etc/passwd')
    expect(ran).toEqual([])
    expect(JSON.stringify(result)).toContain('interface pack')
  })

  it('does not run a write of a pack file that nobody has approved, and runs a read of one', async () => {
    ctx.on('tools/pre-execute', () => Promise.resolve({ kind: 'allow' as const }))
    registerPackJail(ctx, { worldDirectory: () => Promise.resolve(WORLD), reviewing: () => Promise.resolve(false) })
    await call('write', 'harbor/ui/atlas/pack.json')
    expect(ran).toEqual([])
    await call('read', 'harbor/ui/atlas/pack.json')
    expect(ran).toEqual(['read harbor/ui/atlas/pack.json'])
  })

  it('leaves the denial of a listener that comes after it as it is', async () => {
    registerPackJail(ctx, { worldDirectory: () => Promise.resolve(WORLD), reviewing: () => Promise.resolve(false) })
    ctx.on('tools/pre-execute', () => Promise.resolve({ kind: 'deny' as const, reason: 'protected by another plugin' }))
    const result = await call('read', 'harbor/ui/atlas/pack.json')
    expect(ran).toEqual([])
    expect(JSON.stringify(result)).toContain('protected by another plugin')
  })
})
