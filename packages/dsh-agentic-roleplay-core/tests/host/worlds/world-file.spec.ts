import { describe, expect, it } from 'vitest'
import { parseWorldFile, type WorldFile } from '../../../src/host/worlds/world-file.ts'
import { formatIssue } from '../../../src/host/validation.ts'

function parse(text: string): WorldFile {
  const result = parseWorldFile(text)
  if (!result.ok) throw new Error(result.issues.map(formatIssue).join('; '))
  return result.value
}

function issues(text: string): string[] {
  const result = parseWorldFile(text)
  return result.ok ? [] : result.issues.map(formatIssue)
}

describe('parseWorldFile', () => {
  describe('the opening', () => {
    it('is plain text read as one narration, trimmed, and left out when there is none', () => {
      expect(parse(JSON.stringify({ name: 'W', opening_message: '  The lanterns sway.\n\nYou arrive.  ' })).opening).toEqual([{ type: 'narration', text: 'The lanterns sway.\n\nYou arrive.' }])
      expect(parse(JSON.stringify({ name: 'W', opening_message: '   ' }))).not.toHaveProperty('opening')
      expect(parse(JSON.stringify({ name: 'W' }))).not.toHaveProperty('opening')
      expect(parse(JSON.stringify({ name: 'W', opening_message: [] }))).not.toHaveProperty('opening')
    })

    it('can be a list of narration and the lines of characters, in order', () => {
      expect(parse(JSON.stringify({ name: 'W', opening_message: [
        { type: 'narration', text: ' Dusk. ' },
        { type: 'utterance', character: 'clara', text: 'You are late.' },
        { text: 'No type means narration.' },
      ] })).opening).toEqual([
        { type: 'narration', text: 'Dusk.' },
        { type: 'utterance', character: 'clara', text: 'You are late.' },
        { type: 'narration', text: 'No type means narration.' },
      ])
    })

    it('is refused when it is not text or a list, or a part has no words or an utterance no speaker', () => {
      expect(issues(JSON.stringify({ name: 'W', opening_message: 5 }))).toEqual(['opening_message: must be text or a list of parts'])
      expect(issues(JSON.stringify({ name: 'W', opening_message: [{ type: 'narration' }] }))).toHaveLength(1)
      expect(issues(JSON.stringify({ name: 'W', opening_message: [{ type: 'narration', text: '  ' }] }))).toHaveLength(1)
      expect(issues(JSON.stringify({ name: 'W', opening_message: [{ type: 'utterance', text: 'Hi' }] }))).toEqual(['opening_message[0].character: is required'])
      expect(issues(JSON.stringify({ name: 'W', opening_message: ['text'] }))).toHaveLength(1)
    })
  })

  it('reads the fields of a world-simulation-engine export', () => {
    expect(parse(JSON.stringify({
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
    }))).toEqual({
      id: 'world_blackwater_observatory',
      name: 'The Blackwater Observatory',
      description: 'The year is 1912.',
      tags: ['mystery', 'gothic'],
      author: { name: 'Dev Fixture', url: 'https://example.test' },
      coverMediaId: 'media-1',
      clock: { startingTime: Date.UTC(1912, 8, 21, 19, 30) },
    })
  })

  describe('the clock', () => {
    const clockOf = (extra: Record<string, unknown>) => parse(JSON.stringify({ name: 'W', ...extra })).clock

    it('reads when the story begins and the zone its time is read in; a time with no offset is the wall clock of that zone', () => {
      expect(clockOf({ time_zone: 'Asia/Shanghai', starting_time: '1912-09-21T19:30' })).toEqual({ timeZone: 'Asia/Shanghai', startingTime: Date.UTC(1912, 8, 21, 11, 30) })
      expect(clockOf({ time_zone: 'Asia/Shanghai', starting_time: '1912-09-21T19:30Z' })).toEqual({ timeZone: 'Asia/Shanghai', startingTime: Date.UTC(1912, 8, 21, 19, 30) })
      expect(clockOf({ starting_time: '1912-09-21T19:30' })).toEqual({ startingTime: Date.UTC(1912, 8, 21, 19, 30) })
      expect(clockOf({ time_zone: 'UTC' })).toEqual({ timeZone: 'UTC' })
      expect(clockOf({})).toBeUndefined()
    })

    it('reports a zone or a date that is not one, with the field', () => {
      expect(issues(JSON.stringify({ name: 'W', time_zone: 'Mars/Olympus' }))).toEqual([expect.stringMatching(/^time_zone: /)])
      expect(issues(JSON.stringify({ name: 'W', starting_time: 'tomorrow' }))).toEqual([expect.stringMatching(/^starting_time: /)])
    })
  })

  it('needs only a name; a file that has never been indexed has no id', () => {
    expect(parse('{"name":"Plain"}')).toEqual({ name: 'Plain', description: '', tags: [] })
  })

  it('reads the id, treating a blank or null one as missing', () => {
    expect(parse('{"id":" w-1 ","name":"A"}').id).toBe('w-1')
    expect(parse('{"id":null,"name":"A"}')).not.toHaveProperty('id')
    expect(parse('{"id":"  ","name":"A"}')).not.toHaveProperty('id')
  })

  it('treats null like a missing field', () => {
    expect(parse('{"name":"A","description":null,"metadata":{"tags":null},"cover_media_id":null,"author":null}'))
      .toEqual({ name: 'A', description: '', tags: [] })
    expect(parse('{"name":"A","metadata":null}').tags).toEqual([])
  })

  it('accepts an author with only a name', () => {
    expect(parse('{"name":"A","author":{"name":"Me"}}').author).toEqual({ name: 'Me' })
  })

  it('does not read tags from the top level', () => {
    expect(parse('{"name":"A","tags":["x"]}').tags).toEqual([])
  })

  it('ignores unknown fields', () => {
    expect(parse('{"name":"A","future":{"x":1}}').name).toBe('A')
  })

  it.each([
    ['not json', '{', 'invalid JSON'],
    ['not an object', '[]', 'expected a JSON object'],
    ['missing name', '{}', 'name: is required'],
    ['blank name', '{"name":"  "}', 'name: is required'],
    ['non-string name', '{"name":3}', 'name: must be a string'],
    ['non-string id', '{"id":3,"name":"A"}', 'id: must be a string'],
    ['id that is too long', `{"id":"${'x'.repeat(101)}","name":"A"}`, 'id: must be at most 100 characters'],
    ['non-string description', '{"name":"A","description":1}', 'description: must be a string'],
    ['metadata not an object', '{"name":"A","metadata":[]}', 'metadata: must be an object'],
    ['tags not an array', '{"name":"A","metadata":{"tags":"x"}}', 'metadata.tags: must be an array of strings'],
    ['non-string tag', '{"name":"A","metadata":{"tags":["x",2]}}', 'metadata.tags[1]: must be a string'],
    ['author not an object', '{"name":"A","author":"me"}', 'author: must be an object'],
    ['author without a name', '{"name":"A","author":{"url":"x"}}', 'author.name: is required'],
    ['non-string author url', '{"name":"A","author":{"name":"B","url":3}}', 'author.url: must be a string'],
    ['non-string cover id', '{"name":"A","cover_media_id":5}', 'cover_media_id: must be a string'],
  ])('rejects %s', (_label, text, message) => {
    expect(issues(text).some(issue => issue.startsWith(message))).toBe(true)
  })

  it('reports every problem at once', () => {
    expect(issues('{"description":1,"metadata":{"tags":"x"}}').sort()).toEqual([
      'description: must be a string',
      'metadata.tags: must be an array of strings',
      'name: is required',
    ])
  })
})
