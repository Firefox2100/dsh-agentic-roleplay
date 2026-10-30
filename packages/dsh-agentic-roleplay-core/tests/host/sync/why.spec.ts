import { describe, expect, it } from 'vitest'
import { why } from '../../../src/host/sync/rclone.ts'

describe('what a failed rclone run says', () => {
  const result = (stderr: string) => ({ code: 1, stdout: '', stderr })

  it('is the last error line', () => {
    expect(why(result('2026/10/29 10:00:00 ERROR : a.json: Failed to copy: boom\n2026/10/29 10:00:01 NOTICE: Failed to sync with 1 error: last error was: boom'))).toBe('NOTICE: Failed to sync with 1 error: last error was: boom')
  })

  it('names the files that arrived a different size and the usual cause', () => {
    const text = why(result([
      '2026/10/29 10:00:00 ERROR : ui/scene/strip.html: Failed to copy: corrupted on transfer: sizes differ src(webdav root) 383 vs dst(Local file system) 1497',
      '2026/10/29 10:00:00 ERROR : ui/scene/map.html: Failed to copy: corrupted on transfer: sizes differ src(webdav root) 317 vs dst(Local file system) 1431',
      '2026/10/29 10:00:01 NOTICE: Failed to sync with 2 errors: last error was: corrupted on transfer: sizes differ src(webdav root) 317 vs dst(Local file system) 1431',
    ].join('\n')))
    expect(text).toContain('something between this device and the server changes files on the way (ui/scene/strip.html, ui/scene/map.html)')
    expect(text).toContain('CDN')
  })
})
