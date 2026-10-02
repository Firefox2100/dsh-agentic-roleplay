import { Button, IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './Pager.module.css'

/** Previous and next buttons around the current position; the owner supplies every label. */
export function Pager({ label, previousLabel, nextLabel, positionLabel, hasPrevious, hasNext, onPrevious, onNext }: {
  label: string
  previousLabel: string
  nextLabel: string
  positionLabel: string
  hasPrevious: boolean
  hasNext: boolean
  onPrevious: () => void
  onNext: () => void
}) {
  return (
    <nav className={css.pager} aria-label={label}>
      <Button variant="ghost" size="sm" icon={<IconChevronLeftOutlineRegular />} aria-label={previousLabel} disabled={!hasPrevious} onClick={onPrevious} />
      <span className={css.position}>{positionLabel}</span>
      <Button variant="ghost" size="sm" icon={<IconChevronRightOutlineRegular />} aria-label={nextLabel} disabled={!hasNext} onClick={onNext} />
    </nav>
  )
}
