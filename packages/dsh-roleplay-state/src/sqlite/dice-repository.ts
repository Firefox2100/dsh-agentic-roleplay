import { MAX_DICE_CHECKS, type DiceCheck, type DiceCheckDefinition, type DiceReadout, type DiceRoll, type NewDiceRoll } from 'dsh-roleplay-model'
import type { SqlDatabase } from '../driver/types.ts'
import { CorruptDataError, InvalidValueError, NotFoundError } from '../errors.ts'
import type { DiceRepository } from '../repositories.ts'
import { guard, parseNumberList, toJson } from './support.ts'

interface CheckRow { id: number; key: string; name: string; use_text: string; definition: string }

interface RollRow {
  id: number; turn: number; check_key: string | null; expression: string; faces: string; kept: string; modifier: number; target: number | null
  total: number; value: number; readout: string | null; reason: string; character: string | null; by: 'agent' | 'player'; at: string
}

const MAX_ROLLS_LISTED = 200

function parseDefinition(text: string): Omit<DiceCheckDefinition, 'key' | 'name' | 'use'> {
  try {
    return JSON.parse(text) as Omit<DiceCheckDefinition, 'key' | 'name' | 'use'>
  } catch (error) {
    throw new CorruptDataError('a dice check\'s definition is not valid JSON', { cause: error })
  }
}

export class SqliteDiceRepository implements DiceRepository {
  constructor(private readonly db: SqlDatabase, private readonly clock: () => Date) {}

  define(definition: DiceCheckDefinition): DiceCheck {
    if ((this.db.get<{ count: number }>('SELECT count(*) AS count FROM dice_checks')?.count ?? 0) >= MAX_DICE_CHECKS) throw new InvalidValueError(`a story has at most ${MAX_DICE_CHECKS} dice checks`)
    const { key, name, use, ...rest } = definition
    return guard(() => {
      const { lastInsertRowid } = this.db.run('INSERT INTO dice_checks (key, name, use_text, definition) VALUES (?, ?, ?, ?)', [key, name, use, toJson(rest)])
      return this.require(Number(lastInsertRowid))
    })
  }

  checks(): DiceCheck[] {
    return this.db.all<CheckRow>('SELECT * FROM dice_checks ORDER BY id').map(row => this.toCheck(row))
  }

  check(key: string): DiceCheck | undefined {
    const row = this.db.get<CheckRow>('SELECT * FROM dice_checks WHERE key = ?', [key])
    return row === undefined ? undefined : this.toCheck(row)
  }

  removeCheck(key: string): void {
    if (this.db.run('DELETE FROM dice_checks WHERE key = ?', [key]).changes === 0) throw new NotFoundError(`there is no dice check "${key}"`)
  }

  record(roll: NewDiceRoll): DiceRoll {
    const at = this.clock().toISOString()
    const { lastInsertRowid } = this.db.run(
      'INSERT INTO dice_rolls (turn, check_key, expression, faces, kept, modifier, target, total, value, readout, reason, character, by, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [roll.turn, roll.check ?? null, roll.expression, toJson(roll.faces), toJson(roll.kept), roll.modifier, roll.target ?? null, roll.total, roll.value, roll.readout === undefined ? null : toJson(roll.readout), roll.reason, roll.character ?? null, roll.by, at],
    )
    return { ...roll, id: Number(lastInsertRowid), at }
  }

  rolls(filter: { turn?: number; limit?: number } = {}): DiceRoll[] {
    const limit = Math.min(filter.limit ?? MAX_ROLLS_LISTED, MAX_ROLLS_LISTED)
    const rows = filter.turn === undefined
      ? this.db.all<RollRow>('SELECT * FROM (SELECT * FROM dice_rolls ORDER BY id DESC LIMIT ?) ORDER BY id', [limit])
      : this.db.all<RollRow>('SELECT * FROM dice_rolls WHERE turn = ? ORDER BY id LIMIT ?', [filter.turn, limit])
    return rows.map(row => this.toRoll(row))
  }

  private require(id: number): DiceCheck {
    const row = this.db.get<CheckRow>('SELECT * FROM dice_checks WHERE id = ?', [id])
    if (row === undefined) throw new NotFoundError(`there is no dice check ${id}`)
    return this.toCheck(row)
  }

  private toCheck(row: CheckRow): DiceCheck {
    return { id: row.id, key: row.key, name: row.name, use: row.use_text, ...parseDefinition(row.definition) } as DiceCheck
  }

  private toRoll(row: RollRow): DiceRoll {
    return {
      id: row.id, turn: row.turn, expression: row.expression, faces: parseNumberList(row.faces, 'dice_rolls.faces'), kept: parseNumberList(row.kept, 'dice_rolls.kept'),
      modifier: row.modifier, total: row.total, value: row.value, reason: row.reason, by: row.by, at: row.at,
      ...(row.check_key === null ? {} : { check: row.check_key }),
      ...(row.target === null ? {} : { target: row.target }),
      ...(row.readout === null ? {} : { readout: JSON.parse(row.readout) as DiceReadout }),
      ...(row.character === null ? {} : { character: row.character }),
    }
  }
}
