import { useState, type CSSProperties } from 'react'
import { Tag, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { worldCoverPath, type WorldSummary } from '../../../shared/worlds.ts'
import css from './WorldCard.module.css'

/** Stable hue per name, so a world without a cover keeps the same colour. */
function hueOf(name: string): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360
  return hash
}

/** A world as a card. It fills the grid cell it is placed in. */
export function WorldCard({ world }: { world: WorldSummary }) {
  const coverSrc = world.coverVersion === undefined ? undefined : worldCoverPath(world.id, world.coverVersion)
  const [failedSrc, setFailedSrc] = useState<string | undefined>()
  const showCover = coverSrc !== undefined && coverSrc !== failedSrc

  return (
    <Tooltip label={world.description} side="bottom" delayMs={400} maxWidth={320} portal disabled={world.description === ''}>
      <div className={css.card} tabIndex={0} data-testid="world-card">
        <div className={css.cover}>
          {showCover
            ? <img className={css.image} src={coverSrc} alt="" draggable={false} onError={() => { setFailedSrc(coverSrc) }} />
            : (
              <div className={css.placeholder} style={{ '--rp-hue': hueOf(world.name) } as CSSProperties} aria-hidden="true">
                {Array.from(world.name)[0]}
              </div>
            )}
        </div>
        <div className={css.info}>
          <div className={css.name}>{world.name}</div>
          {world.tags.length > 0 && (
            <div className={css.tags}>
              {world.tags.map(tag => <Tag key={tag} tone="neutral" className={css.tag}>{tag}</Tag>)}
            </div>
          )}
        </div>
      </div>
    </Tooltip>
  )
}
