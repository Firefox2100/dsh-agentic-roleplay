import type { DiceCheck } from 'dsh-roleplay-model'
import type { Translate } from 'dsh-roleplay-model'

/** The checks of a story as the game master is told of them: when each is used, what it rolls and what it needs. The result's bands are told by the roll itself. */
export function describeChecks(checks: readonly DiceCheck[], tr: Translate): string {
  if (checks.length === 0) return tr('No checks are defined: use roll_dice only.')
  const lines = checks.map((check) => {
    const needs = [
      tr('Rolls {dice}.', { dice: check.dice }),
      ...(check.reading === 'successes' ? [tr('Counts the dice that show {hit} or more.', { hit: check.hit ?? 0 })] : []),
      ...(check.compare === 'over' ? [tr('Give a target: the difficulty, the number to meet or beat; set it by how hard the attempt is.')] : check.compare === 'under' ? [tr('Give a target: the number to stay under; set it by how hard the attempt is.')] : []),
      ...(check.modifier === undefined ? [] : [tr('It adds the character\'s {variable}.', { variable: check.modifier })]),
    ]
    return `${tr('- {key} ({name}): {use}', { key: check.key, name: check.name, use: check.use.replace(/[.\s]+$/, '') })}. ${needs.join(' ')}`
  })
  return [tr('The checks of this story:'), ...lines].join('\n')
}
