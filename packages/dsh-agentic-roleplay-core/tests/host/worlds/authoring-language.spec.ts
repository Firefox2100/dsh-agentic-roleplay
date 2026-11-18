import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { AuthoringLanguages } from '../../../src/host/worlds/authoring-language.ts'

const folders: string[] = []
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }) })
const made = (): AuthoringLanguages => { const folder = mkdtempSync(join(tmpdir(), 'authoring-language-')); folders.push(folder); return new AuthoringLanguages(new Context(), () => folder) }

describe('what the authoring assistant keeps of a world', () => {
  it('starts on the first conversation and the fallback language', () => {
    const kept = made()
    expect(kept.generation('w1')).toBe(1)
    expect(kept.get('w1')).toBe('en')
  })

  it('moves on to a new conversation without losing the language, and the language change does not undo it', () => {
    const kept = made()
    kept.set('w1', 'zh')
    expect(kept.advance('w1')).toBe(2)
    expect(kept.get('w1')).toBe('zh')
    kept.set('w1', 'en')
    expect(kept.generation('w1')).toBe(2)
    expect(kept.advance('w1')).toBe(3)
    expect(kept.get('w1')).toBe('en')
  })

  it('counts each world apart, and a world that never had a language can still move on', () => {
    const kept = made()
    expect(kept.advance('a')).toBe(2)
    expect(kept.generation('b')).toBe(1)
    expect(kept.get('a')).toBe('en')
  })

  it('says so when what it kept of a world cannot be read, rather than starting over', () => {
    const folder = mkdtempSync(join(tmpdir(), 'authoring-language-'))
    folders.push(folder)
    const kept = new AuthoringLanguages(new Context(), () => folder)
    mkdirSync(join(folder, '.authoring', 'w1.json'), { recursive: true })
    expect(() => kept.get('w1'), 'a folder where the file should be is not an empty file').toThrow(/EISDIR/)
  })
})
