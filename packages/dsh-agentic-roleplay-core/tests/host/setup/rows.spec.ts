import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { profileDirectory, redundantLayers, redundantLayersMessage, selectedBundles } from '../../../src/host/setup/rows.ts'

describe('the bundle layers of a profile', () => {
  it('are fine with the all bundle alone, or with single packages alone', () => {
    expect(redundantLayers(['@deepseek-ai/dsh-base', '@dsh-agentic-roleplay/all'])).toEqual([])
    expect(redundantLayers(['@dsh-agentic-roleplay/core'])).toEqual([])
    expect(redundantLayers(['@dsh-agentic-roleplay/state'])).toEqual([])
  })

  it('name the state layer selected beside the core layer, which already holds the state plugin', () => {
    expect(redundantLayers(['@dsh-agentic-roleplay/state', '@dsh-agentic-roleplay/core'])).toEqual(['@dsh-agentic-roleplay/state'])
  })

  it('name the single-package layers selected beside the all bundle, which would insert its rows twice', () => {
    const found = redundantLayers(['@dsh-agentic-roleplay/state', '@dsh-agentic-roleplay/all', '@dsh-agentic-roleplay/core', '@someone/else'])
    expect(found).toEqual(['@dsh-agentic-roleplay/state', '@dsh-agentic-roleplay/core'])
    expect(redundantLayersMessage(found)).toMatch(/"@dsh-agentic-roleplay\/state", "@dsh-agentic-roleplay\/core".*next to a layer that already inserts the same plugin rows/)
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

    it('names the profile DSH launched the plugin in through DSH_PROFILE_DIR', () => {
      const before = { dir: process.env.DSH_PROFILE_DIR, home: process.env.DSH_HOME, profile: process.env.DSH_PROFILE }
      try {
        process.env.DSH_PROFILE_DIR = join(tmpdir(), 'some-profile')
        expect(profileDirectory()).toBe(join(tmpdir(), 'some-profile'))
        delete process.env.DSH_PROFILE_DIR
        delete process.env.DSH_HOME
        delete process.env.DSH_PROFILE
        expect(profileDirectory()).toBeUndefined()
        process.env.DSH_HOME = join(tmpdir(), 'home')
        process.env.DSH_PROFILE = 'roleplay-dev'
        expect(profileDirectory()).toBe(join(tmpdir(), 'home', 'profiles', 'roleplay-dev'))
      } finally {
        if (before.dir === undefined) delete process.env.DSH_PROFILE_DIR
        else process.env.DSH_PROFILE_DIR = before.dir
        if (before.home === undefined) delete process.env.DSH_HOME
        else process.env.DSH_HOME = before.home
        if (before.profile === undefined) delete process.env.DSH_PROFILE
        else process.env.DSH_PROFILE = before.profile
      }
    })
  })
})
