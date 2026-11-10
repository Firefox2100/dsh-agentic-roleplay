import { Button } from '../../ui/Button.tsx'
import css from './Pager.module.css'import { IconChevronLeft, IconChevronRight } from '../../ui/icons.tsx'


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
      <Button variant="ghost" size="sm" icon={<IconChevronLeft />} aria-label={previousLabel} disabled={!hasPrevious} onClick={onPrevious} />
      <span className={css.position}>{positionLabel}</span>
      <Button variant="ghost" size="sm" icon={<IconChevronRight />} aria-label={nextLabel} disabled={!hasNext} onClick={onNext} />
    </nav>
  )
}
