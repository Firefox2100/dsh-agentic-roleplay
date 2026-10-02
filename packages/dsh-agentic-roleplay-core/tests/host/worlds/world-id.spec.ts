import { describe, expect, it } from 'vitest'
import { withWorldId } from '../../../src/host/worlds/world-id.ts'

describe('withWorldId', () => {
  it('puts the id first and keeps the other fields in their order', () => {
    const text = withWorldId('{\n  "name": "W",\n  "description": "D",\n  "metadata": { "tags": ["a"] }\n}\n', 'abc')
    expect(Object.keys(JSON.parse(text))).toEqual(['id', 'name', 'description', 'metadata'])
    expect(JSON.parse(text)).toEqual({ id: 'abc', name: 'W', description: 'D', metadata: { tags: ['a'] } })
  })

  it('keeps the indentation the file uses', () => {
    expect(withWorldId('{\n    "name": "W"\n}\n', 'abc')).toBe('{\n    "id": "abc",\n    "name": "W"\n}\n')
    expect(withWorldId('{\n\t"name": "W"\n}\n', 'abc')).toBe('{\n\t"id": "abc",\n\t"name": "W"\n}\n')
  })

  it('keeps a missing final newline missing, and a present one present', () => {
    expect(withWorldId('{\n  "name": "W"\n}', 'abc').endsWith('}')).toBe(true)
    expect(withWorldId('{\n  "name": "W"\n}\n', 'abc').endsWith('}\n')).toBe(true)
  })

  it('writes a compact file with the default indentation', () => {
    expect(withWorldId('{"name":"W"}', 'abc')).toBe('{\n  "id": "abc",\n  "name": "W"\n}')
  })

  it('replaces a blank or null id instead of adding a second one', () => {
    for (const text of ['{"id":"","name":"W"}', '{"id":null,"name":"W"}', '{"name":"W","id":" "}']) {
      const result = JSON.parse(withWorldId(text, 'abc')) as Record<string, unknown>
      expect(result).toEqual({ id: 'abc', name: 'W' })
      expect(Object.keys(result)).toEqual(['id', 'name'])
    }
  })

  it('reads past a byte order mark', () => {
    expect(JSON.parse(withWorldId('﻿{"name":"W"}', 'abc'))).toEqual({ id: 'abc', name: 'W' })
  })

  it('keeps non-ASCII text as it is', () => {
    expect(withWorldId('{"name":"黑水天文台"}', 'abc')).toContain('"name": "黑水天文台"')
  })
})
