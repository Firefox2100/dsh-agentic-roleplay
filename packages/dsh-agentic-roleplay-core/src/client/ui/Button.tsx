import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import css from './Button.module.css'

/** Visual variant, each backed by its --dsw-alias-button-* token family. */
export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'toolbar'

/** Render a button; native button attributes pass through, and `icon` is a leading 16px node. */
export const Button = forwardRef<HTMLButtonElement, {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
  icon?: ReactNode
  className?: string | undefined
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>>(function Button({ variant = 'ghost', size = 'md', icon, className, children, ...rest }, ref) {
  const classes = [css.rpButton, css[variant === 'primary' ? 'rpPrimary' : variant === 'outline' ? 'rpOutline' : variant === 'toolbar' ? 'rpToolbar' : 'rpGhost'], size === 'sm' ? css.rpSm : css.rpMd]
  if (className !== undefined) classes.push(className)
  return (
    <button ref={ref} type="button" className={classes.join(' ')} {...rest}>
      {icon != null && <span className={css.rpIcon}>{icon}</span>}
      {children}
    </button>
  )
})
