import type { RecordsView } from '@dsh-agentic-roleplay/state'
import type { StateChange, StoryComparison } from '../../shared/compare.ts'

/** What is compared of one state of a story: the records as models read them, the story's time and how many turns were played. */
export interface StateSide {
  label: string
  turns: number
  now: string | undefined
  view: RecordsView
}


/** The differences between two lists of rows that share a key: a row only one side has, and a row whose summary differs. */
function differences<T extends object>(area: StateChange['area'], a: readonly T[], b: readonly T[], key: (row: T) => string, subject: (row: T) => string, summary: (row: T) => string): StateChange[] {
  const before = new Map(a.map(row => [key(row), row]))
  const after = new Map(b.map(row => [key(row), row]))
  const changes: StateChange[] = []
  for (const [id, row] of before) {
    const other = after.get(id)
    if (other === undefined) changes.push({ area, subject: subject(row), a: summary(row) })
    else if (summary(other) !== summary(row)) changes.push({ area, subject: subject(row), a: summary(row), b: summary(other) })
  }
  for (const [id, row] of after) if (!before.has(id)) changes.push({ area, subject: subject(row), b: summary(row) })
  return changes
}

const place = (row: RecordsView['characters'][number]): string => (row.location === null ? 'nowhere' : `${row.location}${row.position === '' ? '' : ` (${row.position})`}`)
const number = (value: number): string => String(Math.round(value * 100) / 100)

/** Compares two states of a story: positions, activity, things, tracked values, open threads, relationships, commitments and the story's time. */
export function compareStates(first: StateSide, second: StateSide): StoryComparison {
  const changes: StateChange[] = []
  if (first.now !== second.now) changes.push({ area: 'time', subject: 'story time', ...first.now === undefined ? {} : { a: first.now }, ...second.now === undefined ? {} : { b: second.now } })
  if (first.turns !== second.turns) changes.push({ area: 'turns', subject: 'turns played', a: String(first.turns), b: String(second.turns) })
  const a = first.view
  const b = second.view
  changes.push(
    ...differences('position', a.characters, b.characters, row => row.character, row => row.name, place),
    ...differences('activity', a.characters, b.characters, row => row.character, row => row.name, row => row.activity),
    ...differences('item', a.items, b.items, row => row.key, row => row.name, row => `${row.holder}${row.quantity === 1 ? '' : `, ${row.quantity}`}${row.state === null ? '' : `, ${row.state}`}`),
    ...differences('variable', a.variables, b.variables, row => `${row.variable}|${row.subject}`, row => `${row.variable} of ${row.about || row.subject}`, row => String(row.value)),
    ...differences('thread', a.open_threads, b.open_threads, row => row.text, () => 'open thread', row => row.text),
    ...differences('relationship', a.relationships, b.relationships, row => `${row.from}>${row.to}`, row => `${row.from} to ${row.to}`, row => `${row.label} (trust ${number(row.trust)}, affinity ${number(row.affinity)}, tension ${number(row.tension)})`),
    ...differences('engagement', a.engagements, b.engagements, row => `${row.title}|${row.at}`, row => row.title, row => row.at),
  )
  return { a: first.label, b: second.label, changes }
}
