import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nodeSqliteDriver, type SqlDatabase } from '../src/index.ts'

let db: SqlDatabase

beforeEach(() => {
  db = nodeSqliteDriver.open(':memory:')
  db.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT')
  db.exec('CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent (id)) STRICT')
})
afterEach(() => { db.close() })

describe('node:sqlite driver', () => {
  it('runs statements with parameters and reads rows back', () => {
    expect(db.run('INSERT INTO parent (name) VALUES (?)', ['a'])).toEqual({ changes: 1, lastInsertRowid: 1 })
    db.run('INSERT INTO parent (name) VALUES (?)', ['b'])
    expect(db.get<{ name: string }>('SELECT name FROM parent WHERE id = ?', [2])?.name).toBe('b')
    expect(db.get('SELECT * FROM parent WHERE id = ?', [9])).toBeUndefined()
    expect(db.all<{ name: string }>('SELECT name FROM parent ORDER BY id').map(row => row.name)).toEqual(['a', 'b'])
  })

  it('enforces foreign keys', () => {
    expect(() => db.run('INSERT INTO child (parent_id) VALUES (?)', [42])).toThrow(/FOREIGN KEY/)
  })

  describe('transaction', () => {
    it('keeps the changes and returns the result', () => {
      expect(db.transaction(() => {
        db.run('INSERT INTO parent (name) VALUES (?)', ['a'])
        return 'done'
      })).toBe('done')
      expect(db.all('SELECT * FROM parent')).toHaveLength(1)
    })

    it('undoes the changes when the callback throws', () => {
      expect(() => db.transaction(() => {
        db.run('INSERT INTO parent (name) VALUES (?)', ['a'])
        throw new Error('boom')
      })).toThrow('boom')
      expect(db.all('SELECT * FROM parent')).toHaveLength(0)
    })

    it('joins an outer transaction, and an inner failure caught inside only undoes the inner part', () => {
      db.transaction(() => {
        db.run('INSERT INTO parent (name) VALUES (?)', ['outer'])
        expect(() => db.transaction(() => {
          db.run('INSERT INTO parent (name) VALUES (?)', ['inner'])
          throw new Error('inner failed')
        })).toThrow('inner failed')
        db.transaction(() => { db.run('INSERT INTO parent (name) VALUES (?)', ['kept']) })
      })
      expect(db.all<{ name: string }>('SELECT name FROM parent ORDER BY id').map(row => row.name)).toEqual(['outer', 'kept'])
    })

    it('undoes everything when the outer callback fails after an inner one succeeded', () => {
      expect(() => db.transaction(() => {
        db.transaction(() => { db.run('INSERT INTO parent (name) VALUES (?)', ['inner']) })
        throw new Error('outer failed')
      })).toThrow('outer failed')
      expect(db.all('SELECT * FROM parent')).toHaveLength(0)
    })

    it('can be used again after a failure', () => {
      expect(() => db.transaction(() => { throw new Error('x') })).toThrow()
      db.transaction(() => { db.run('INSERT INTO parent (name) VALUES (?)', ['a']) })
      expect(db.all('SELECT * FROM parent')).toHaveLength(1)
    })

    it('refuses an asynchronous callback', () => {
      expect(() => db.transaction(() => Promise.resolve(1) as unknown as number)).toThrow('synchronous')
      expect(db.all('SELECT * FROM parent')).toHaveLength(0)
    })
  })

  it('rejects an invalid busy timeout', () => {
    expect(() => nodeSqliteDriver.open(':memory:', { busyTimeoutMs: -1 })).toThrow(RangeError)
  })
})
