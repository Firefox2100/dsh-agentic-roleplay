import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import css from './Tag.module.css'

/** Palette selector; each tone names one shipped appearance. */
export type TagTone =
  /** Hairline outline on tertiary text: the read-only default. */
  | 'outline'
  /** Inverted fill: one tag per group that names the current selection. */
  | 'solid'
  /** Platform-grey fill: a neutral fact with no status meaning. */
  | 'neutral'
  /** Text only, no fill: a fact stated more quietly than `neutral`. */
  | 'quiet'
  /** Tinted green: a healthy or enabled state. */
  | 'success'
  /** Tinted blue: informational classification, not health. */
  | 'info'
  /** Tinted amber: attention needed, not yet a failure. */
  | 'warning'
  /** Tinted red: a failure. */
  | 'danger'

/** Render a read-only tag; the label belongs to the render site. */
export function Tag({ tone = 'outline', className, children, ...rest }: {
  tone?: TagTone
  className?: string | undefined
  children?: ReactNode
} & Omit<ComponentPropsWithoutRef<'span'>, 'children' | 'className'>) {
  return <span {...rest} className={className === undefined ? css.rpTag : `${css.rpTag} ${className}`} data-tone={tone}>{children}</span>
}
