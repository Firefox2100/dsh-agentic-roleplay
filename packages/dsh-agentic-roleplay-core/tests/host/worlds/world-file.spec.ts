import { describe, expect, it } from 'vitest'
import { parseWorldFile, WorldFileError } from '../../../src/host/worlds/world-file.ts'

describe('parseWorldFile', () => {
  it('reads the fields of a world-simulation-engine export', () => {
    const world = parseWorldFile(JSON.stringify({
      id: 'world_blackwater_observatory',
      name: ' The Blackwater Observatory ',
      description: ' The year is 1912. ',
      starting_time: '1912-09-21T19:30:00Z',
      version: 1,
      language: 'en',
      author: { id: 'author_1', name: ' Dev Fixture ', url: 'https://example.test' },
      metadata: { tags: ['mystery', ' mystery ', '', 'gothic'] },
      creation_time: '2026-01-01T00:00:00Z',
      cover_media_id: 'media-1',
    }))
    expect(world).toEqual({
      name: 'The Blackwater Observatory',
      description: 'The year is 1912.',
      tags: ['mystery', 'gothic'],
      author: { name: 'Dev Fixture', url: 'https://example.test' },
      coverMediaId: 'media-1',
    })
  })

  it('needs only a name', () => {
    expect(parseWorldFile('{"name":"Plain"}')).toEqual({ name: 'Plain', description: '', tags: [] })
  })

  it('treats null like a missing field', () => {
    expect(parseWorldFile('{"name":"A","description":null,"metadata":{"tags":null},"cover_media_id":null}'))
      .toEqual({ name: 'A', description: '', tags: [] })
    expect(parseWorldFile('{"name":"A","metadata":null}').tags).toEqual([])
    expect(parseWorldFile('{"name":"A","author":null}').author).toBeUndefined()
  })

  it('accepts an author with only a name', () => {
    expect(parseWorldFile('{"name":"A","author":{"name":"Me"}}').author).toEqual({ name: 'Me' })
  })

  it('does not read tags from the top level', () => {
    expect(parseWorldFile('{"name":"A","tags":["x"]}').tags).toEqual([])
  })

  it('ignores a byte order mark and unknown fields', () => {
    expect(parseWorldFile('﻿{"name":"A","future":{"x":1}}').name).toBe('A')
  })

  it.each([
    ['not json', '{', 'invalid JSON'],
    ['not an object', '[]', 'JSON object'],
    ['missing name', '{}', '"name" is required'],
    ['blank name', '{"name":"  "}', '"name" is required'],
    ['non-string name', '{"name":3}', '"name" must be a string'],
    ['non-string description', '{"name":"A","description":1}', '"description" must be a string'],
    ['metadata not an object', '{"name":"A","metadata":[]}', '"metadata" must be an object'],
    ['tags not an array', '{"name":"A","metadata":{"tags":"x"}}', '"metadata.tags" must be an array'],
    ['non-string tag', '{"name":"A","metadata":{"tags":["x",2]}}', '"metadata.tags" must be an array'],
    ['author not an object', '{"name":"A","author":"me"}', '"author" must be an object'],
    ['author without a name', '{"name":"A","author":{"url":"x"}}', '"author.name" is required'],
    ['non-string author url', '{"name":"A","author":{"name":"B","url":3}}', '"author.url" must be a string'],
    ['non-string cover id', '{"name":"A","cover_media_id":5}', '"cover_media_id" must be a string'],
  ])('rejects %s', (_label, text, message) => {
    expect(() => parseWorldFile(text)).toThrow(WorldFileError)
    expect(() => parseWorldFile(text)).toThrow(message)
  })
})
