import { describeValue, type ShownVariable } from '@dsh-agentic-roleplay/state'

/** What is tracked of a subject, in a line: `Health: hurt (2); Valence: unhappy (-0.4), usually even (0)`. */
export function describeShown(shown: readonly ShownVariable[]): string {
  return shown.map(({ variable, value, baseline }) => {
    const usual = baseline !== undefined && baseline !== value ? `, usually ${describeValue(variable, baseline)}` : ''
    return `${variable.name}: ${describeValue(variable, value)}${usual}`
  }).join('; ')
}
