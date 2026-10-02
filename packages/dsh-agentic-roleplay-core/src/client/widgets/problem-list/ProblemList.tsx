import type { WorldProblem } from '../../../shared/worlds.ts'
import css from './ProblemList.module.css'

/** A collapsed list of what went wrong while reading files; renders nothing when nothing did. */
export function ProblemList({ summary, problems }: { summary: string; problems: readonly WorldProblem[] }) {
  if (problems.length === 0) return null
  return (
    <details className={css.problems}>
      <summary>{summary}</summary>
      <ul>
        {problems.map(problem => (
          <li key={`${problem.path}:${problem.message}`}><code>{problem.path}</code> {problem.message}</li>
        ))}
      </ul>
    </details>
  )
}
