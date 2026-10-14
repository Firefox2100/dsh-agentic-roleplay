import { describe, expect, it } from 'vitest'
import { MAX_PACK_TEXT, packFileProblem, packJail } from '../../../src/host/authoring/pack-jail.ts'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'

const WORLD = '/roots/worlds/harbor'
const allow = () => Promise.resolve({ kind: 'allow' } as never)
const exec = (name: string, args: Record<string, unknown>, chat = authoringChatSessionId('harbor')) => ({ name, arguments: args, agent: { session: { id: chat, header: { cwd: '/roots/worlds' } } } }) as never
const deps = (reviewing = false) => ({ worldDirectory: () => Promise.resolve(WORLD), reviewing: () => Promise.resolve(reviewing) })
const decide = (name: string, args: Record<string, unknown>, next = allow, reviewing = false) => packJail(exec(name, args), next, deps(reviewing))

describe('which files of a world a file tool may reach', () => {
  it('are the text files of a pack folder under ui', () => {
    expect(packFileProblem('write', `${WORLD}/ui/atlas/pack.json`, WORLD)).toBeUndefined()
    expect(packFileProblem('read', `${WORLD}/ui/atlas/img/map.svg`, WORLD)).toBeUndefined()
  })

  it('are nothing else: not the world, other worlds, the folder itself, other file types, hidden names, or a way out', () => {
    for (const path of [`${WORLD}/world.json`, `${WORLD}/characters/a/character.json`, `${WORLD}/ui`, `${WORLD}/ui/pack.json`, `${WORLD}/ui/atlas/run.sh`, `${WORLD}/ui/atlas/logo.png`, `${WORLD}/ui/.hidden/x.json`, `${WORLD}/ui/atlas/.x.json`, `${WORLD}/ui/a b/x.json`, `${WORLD}/ui/../world.json`, '/roots/worlds/other/ui/atlas/pack.json', '/etc/passwd', `${WORLD}-x/ui/atlas/pack.json`]) {
      expect(packFileProblem('write', path, WORLD), path).toBeDefined()
    }
  })

  it('may carry no more text than a pack file holds', () => {
    expect(packFileProblem('write', `${WORLD}/ui/atlas/a.html`, WORLD, ['x'.repeat(MAX_PACK_TEXT)])).toBeUndefined()
    expect(packFileProblem('write', `${WORLD}/ui/atlas/a.html`, WORLD, ['x'.repeat(MAX_PACK_TEXT + 1)])).toContain('at most 200 KB')
  })
})

describe('the jail of the file tools in an authoring chat', () => {
  it('leaves every other tool and every other chat alone', async () => {
    expect(await decide('list_world_packs', {})).toEqual({ kind: 'allow' })
    expect(await packJail(exec('write', { file_path: '/etc/passwd', content: 'x' }, 'session-0b8d9a52-2a39-4c10-9d3e-6a1f4d1a7c11'), allow, deps())).toEqual({ kind: 'allow' })
  })

  it('refuses a path outside the packs, however it is written, before anything after it is asked', async () => {
    let reached = false
    const next = () => { reached = true; return allow() }
    for (const file_path of ['/etc/passwd', '../harbor/world.json', 'harbor/world.json', '~/x.json', `${WORLD}/ui/../world.json`, '', 4]) {
      expect(await decide('write', { file_path, content: 'x' }, next), String(file_path)).toMatchObject({ kind: 'deny' })
    }
    expect(reached).toBe(false)
  })

  it('takes a path relative to the folder of the chat, and an absolute one', async () => {
    expect(await decide('write', { file_path: 'harbor/ui/atlas/pack.json', content: '{}' })).toMatchObject({ kind: 'ask' })
    expect(await decide('edit', { file_path: `${WORLD}/ui/atlas/pack.json`, old_string: 'a', new_string: 'b' })).toMatchObject({ kind: 'ask', displayReason: { en: expect.stringContaining('atlas/pack.json') } })
  })

  it('lets a read through without asking and asks before a write or an edit', async () => {
    expect(await decide('read', { file_path: `${WORLD}/ui/atlas/pack.json` })).toEqual({ kind: 'allow' })
    expect(await decide('write', { file_path: `${WORLD}/ui/atlas/pack.json`, content: '{}' })).toMatchObject({ kind: 'ask' })
  })

  it('keeps what a plugin after it decides: a denial or an ask of its own is not turned into anything else', async () => {
    const path = `${WORLD}/ui/atlas/pack.json`
    expect(await decide('write', { file_path: path, content: '{}' }, () => Promise.resolve({ kind: 'deny', reason: 'protected' } as never))).toEqual({ kind: 'deny', reason: 'protected' })
    expect(await decide('write', { file_path: path, content: '{}' }, () => Promise.resolve({ kind: 'ask', reason: 'theirs' } as never))).toEqual({ kind: 'ask', reason: 'theirs' })
  })

  it('refuses a write that carries too much, and any write in the turn that reviews an import', async () => {
    const path = `${WORLD}/ui/atlas/a.html`
    expect(await decide('write', { file_path: path, content: 'x'.repeat(MAX_PACK_TEXT + 1) })).toMatchObject({ kind: 'deny' })
    expect(await decide('edit', { file_path: path, old_string: 'a', new_string: 'x'.repeat(MAX_PACK_TEXT + 1) })).toMatchObject({ kind: 'deny' })
    expect(await decide('write', { file_path: path, content: 'x' }, allow, true)).toMatchObject({ kind: 'deny', reason: expect.stringContaining('import') })
    expect(await decide('read', { file_path: path }, allow, true)).toEqual({ kind: 'allow' })
  })

  it('refuses when the world of the chat is gone', async () => {
    expect(await packJail(exec('read', { file_path: '/x' }), allow, { worldDirectory: () => Promise.resolve(undefined), reviewing: () => Promise.resolve(false) })).toMatchObject({ kind: 'deny' })
  })
})
