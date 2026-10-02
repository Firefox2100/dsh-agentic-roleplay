import { describe, expect, it } from 'vitest'
import { Reader, formatIssue, type Issue } from '../../src/host/validation.ts'

function read(json: string): { reader: Reader; issues: Issue[] } {
  const issues: Issue[] = []
  const reader = Reader.fromJson(json, issues)
  if (reader === undefined) throw new Error(`not readable: ${issues.map(formatIssue).join(', ')}`)
  return { reader, issues }
}

describe('Reader.fromJson', () => {
  it.each([
    ['{', 'invalid JSON'],
    ['[]', 'expected a JSON object'],
    ['"x"', 'expected a JSON object'],
  ])('rejects %s', (text, message) => {
    const issues: Issue[] = []
    expect(Reader.fromJson(text, issues)).toBeUndefined()
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain(message)
  })

  it('ignores a byte order mark', () => {
    expect(read('﻿{"a":"b"}').reader.string('a')).toBe('b')
  })
})

describe('Reader', () => {
  it('reads missing, null and blank values as absent', () => {
    const { reader, issues } = read('{"a":null,"b":"  "}')
    expect(reader.string('a')).toBeUndefined()
    expect(reader.string('b')).toBeUndefined()
    expect(reader.string('c')).toBeUndefined()
    expect(reader.text('c')).toBe('')
    expect(issues).toEqual([])
  })

  it('trims strings and reports required ones that are absent', () => {
    const { reader, issues } = read('{"a":"  x  ","b":" "}')
    expect(reader.string('a', { required: true })).toBe('x')
    reader.string('b', { required: true })
    reader.string('c', { required: true })
    expect(issues).toEqual([{ path: 'b', message: 'is required' }, { path: 'c', message: 'is required' }])
  })

  it('reports wrong types with the field path', () => {
    const { reader, issues } = read('{"a":1,"n":"x","o":[],"list":"x"}')
    reader.string('a')
    reader.number('n')
    reader.object('o')
    reader.strings('list')
    expect(issues.map(formatIssue)).toEqual([
      'a: must be a string',
      'n: must be a number',
      'o: must be an object',
      'list: must be an array of strings',
    ])
  })

  it('checks number ranges', () => {
    const { reader, issues } = read('{"a":2,"b":0.5}')
    expect(reader.number('a', { min: 0, max: 1 })).toBeUndefined()
    expect(reader.number('b', { min: 0, max: 1 })).toBe(0.5)
    expect(issues.map(formatIssue)).toEqual(['a: must be between 0 and 1'])
  })

  it('accepts only allowed values and falls back otherwise', () => {
    const { reader, issues } = read('{"a":"x","b":"z"}')
    expect(reader.oneOf('a', ['x', 'y'], 'y')).toBe('x')
    expect(reader.oneOf('b', ['x', 'y'], 'y')).toBe('y')
    expect(reader.oneOf('c', ['x', 'y'], 'y')).toBe('y')
    expect(issues.map(formatIssue)).toEqual(['b: must be one of: x, y'])
  })

  it('cleans string lists', () => {
    const { reader, issues } = read('{"a":[" x ","","x","y",3]}')
    expect(reader.strings('a')).toEqual(['x', 'y'])
    expect(issues.map(formatIssue)).toEqual(['a[4]: must be a string'])
  })

  it('reports nested problems with the full path', () => {
    const { reader, issues } = read('{"start":{"items":[{"n":1},"bad"]}}')
    const items = reader.object('start')?.objects('items') ?? []
    expect(items).toHaveLength(1)
    items[0]?.string('n')
    expect(issues.map(formatIssue)).toEqual(['start.items[1]: must be an object', 'start.items[0].n: must be a string'])
  })
})
