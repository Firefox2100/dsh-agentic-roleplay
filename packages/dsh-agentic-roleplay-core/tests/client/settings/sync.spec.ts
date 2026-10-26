import { describe, expect, it } from 'vitest'
import { DEFAULT_SYNC } from '../../../src/shared/sync.ts'
import { syncDraftOf, syncField, syncFromDraft, syncOf, syncProblem } from '../../../src/client/settings/sync.ts'

describe('sync settings', () => {
  it('normalizes unknown values and interval minutes', () => {
    expect(syncOf({ remote: 3, rclone: ' rclone ', intervalMinutes: 4.9 })).toEqual({ ...DEFAULT_SYNC, rclone: ' rclone ', intervalMinutes: 4 })
    expect(syncOf({ intervalMinutes: -2 })).toEqual({ ...DEFAULT_SYNC, intervalMinutes: 0 })
    expect(syncFromDraft('{')).toEqual(DEFAULT_SYNC)
  })

  it('keeps the interval text so invalid input can be reported', () => {
    expect(syncDraftOf('{"remote":"box:","intervalMinutes":"later"}')).toEqual({ config: { ...DEFAULT_SYNC, remote: 'box:' }, intervalText: 'later' })
    expect(syncDraftOf('{')).toEqual({ config: DEFAULT_SYNC, intervalText: '0' })
  })

  it('allows sync to be off and reports each invalid configured field', () => {
    expect(syncProblem(DEFAULT_SYNC, '0')).toBeUndefined()
    expect(syncProblem(DEFAULT_SYNC, '1.5')).toBe('interval')
    expect(syncProblem({ ...DEFAULT_SYNC, remote: 'two words' }, '0')).toBe('remote')
    expect(syncProblem({ ...DEFAULT_SYNC, remote: 'box:', configFile: 'relative.conf' }, '0')).toBe('config')
    expect(syncProblem({ ...DEFAULT_SYNC, remote: 'box:', configFile: '~/rclone.conf', passwordRef: '9 bad' }, '0')).toBe('keyName')
  })

  it('clears empty settings, trims configured settings, and refuses an invalid draft', () => {
    expect(syncField.parse(JSON.stringify(DEFAULT_SYNC))).toEqual({ kind: 'clear' })
    expect(syncField.parse('{"remote":" box: ","rclone":" /bin/rclone ","configFile":" ~/rclone.conf ","passwordRef":" SYNC_KEY ","intervalMinutes":"15"}')).toEqual({
      kind: 'set', value: { remote: 'box:', rclone: '/bin/rclone', configFile: '~/rclone.conf', passwordRef: 'SYNC_KEY', intervalMinutes: 15 },
    })
    expect(syncField.parse('{"remote":"box:","intervalMinutes":"soon"}')).toBeUndefined()
  })
})
