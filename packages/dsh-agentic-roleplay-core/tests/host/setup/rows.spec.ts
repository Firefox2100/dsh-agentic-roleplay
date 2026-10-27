import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { redundantLayers, redundantLayersMessage, selectedBundles } from '../../../src/host/setup/rows.ts'

describe('the bundle layers of a profile', () => {
  it('are fine with the all bundle alone, or with single packages alone', () => {
    expect(redundantLayers(['@deepseek-ai/dsh-base', '@dsh-agentic-roleplay/all'])).toEqual([])
    expect(redundantLayers(['@dsh-agentic-roleplay/state', '@dsh-agentic-roleplay/core'])).toEqual([])
  })

  it('name the single-package layers selected beside the all bundle, which would insert its rows twice', () => {
    const found = redundantLayers(['@dsh-agentic-roleplay/state', '@dsh-agentic-roleplay/all', '@dsh-agentic-roleplay/core', '@someone/else'])
    expect(found).toEqual(['@dsh-agentic-roleplay/state', '@dsh-agentic-roleplay/core'])
    expect(redundantLayersMessage(found)).toMatch(/"@dsh-agentic-roleplay\/state", "@dsh-agentic-roleplay\/core".*next to the all bundle/)
  })

  describe('read from the profile', () => {
    let dir: string | undefined
    afterEach(async () => { if (dir !== undefined) await rm(dir, { recursive: true, force: true }); dir = undefined })

    it('is its selected bundles, and nothing when there is no profile to read', async () => {
      dir = await mkdtemp(join(tmpdir(), 'profile-'))
      expect(selectedBundles(dir)).toEqual([])
      await writeFile(join(dir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['a', 3, 'b'] } } }))
      expect(selectedBundles(dir)).toEqual(['a', 'b'])
      expect(selectedBundles(undefined)).toEqual([])
    })
  })
})
