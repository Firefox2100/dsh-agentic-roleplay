import type { AvatarSummary } from '../../avatars-api.ts'
import css from './AvatarChoices.module.css'

/** A list of avatars to tick: the ones brought into a world or a session. */
export function AvatarChoices({ avatars, selected, disabled, onToggle }: { avatars: readonly AvatarSummary[]; selected: ReadonlySet<string>; disabled?: boolean; onToggle: (key: string) => void }) {
  return (
    <>
      {avatars.map(avatar => (
        <label key={avatar.key} className={css.option}>
          <input type="checkbox" checked={selected.has(avatar.key)} disabled={disabled} onChange={() => { onToggle(avatar.key) }} />
          <span className={css.text}>
            <span className={css.name}>{avatar.name}</span>
            {avatar.summary !== '' && <span className={css.summary}>{avatar.summary}</span>}
          </span>
        </label>
      ))}
    </>
  )
}
