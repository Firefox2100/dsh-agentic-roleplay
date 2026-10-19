import { describe, expect, it } from 'vitest'
import { CatalogueError } from '../../../src/host/catalogue/errors.ts'
import { archivePathProblem, readZip } from '../../../src/host/catalogue/zip.ts'
import { makeZip } from '../../support/zip.ts'

const limits = { maxBytes: 1024 * 1024 }
const refuses = (archive: Buffer, message: RegExp, maxBytes = limits.maxBytes): void => {
  try { readZip(archive, { maxBytes }) } catch (error) { expect(error).toBeInstanceOf(CatalogueError); expect((error as CatalogueError).message).toMatch(message); expect((error as CatalogueError).failure).toBe('invalid'); return }
  throw new Error('the archive was accepted')
}

describe('reading a ZIP archive', () => {
  it('reads deflated and stored files and skips folders', () => {
    const files = readZip(makeZip([{ name: 'w/' }, { name: 'w/a.json', content: '{"a":1}' }, { name: 'w/b.txt', content: 'plain', stored: true }, { name: 'w/empty', content: '' }]), limits)
    expect([...files.keys()]).toEqual(['w/a.json', 'w/b.txt', 'w/empty'])
    expect(files.get('w/a.json')?.toString()).toBe('{"a":1}')
    expect(files.get('w/b.txt')?.toString()).toBe('plain')
  })

  it('refuses what is not an archive', () => {
    refuses(Buffer.from('<html>sign in</html>'), /not a ZIP/)
  })

  it('refuses paths that could leave the folder', () => {
    for (const name of ['../x', 'w/../../x', '/etc/x', 'C:/x', 'w\\x', 'w//x', 'w/./x']) refuses(makeZip([{ name, content: 'x' }]), /archive path/)
    expect(archivePathProblem('w/a/b.json')).toBeUndefined()
    expect(archivePathProblem('w/dir/')).toBeUndefined()
  })

  it('refuses links, encryption, repeats, and paths that differ only by case', () => {
    refuses(makeZip([{ name: 'w/link', content: '/etc/passwd', mode: 0o120777 }]), /holds a link/)
    refuses(makeZip([{ name: 'w/a', content: 'x', encrypted: true }]), /encrypted/)
    refuses(makeZip([{ name: 'w/a', content: 'x' }, { name: 'w/a', content: 'y' }]), /repeats a path/)
    refuses(makeZip([{ name: 'w/a', content: 'x' }, { name: 'w/A', content: 'y' }]), /repeats a path/)
  })

  it('refuses too many bytes, whether the archive declares them or lies about them', () => {
    refuses(makeZip([{ name: 'w/big', content: 'x'.repeat(5000) }]), /more than 1000 bytes/, 1000)
    refuses(makeZip([{ name: 'w/liar', content: 'x'.repeat(5000), declaredSize: 10 }]), /cannot be unpacked/, 1000)
    refuses(makeZip([{ name: 'w/short', content: 'abcdef', declaredSize: 600 }]), /declared size/)
  })

  it('refuses an archive cut short', () => {
    const archive = makeZip([{ name: 'w/a', content: 'x'.repeat(200) }])
    refuses(archive.subarray(10), /damaged/)
    refuses(archive.subarray(0, archive.length - 5), /not a ZIP/)
  })
})
