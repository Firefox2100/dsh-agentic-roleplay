import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import css from './Input.module.css'

/** Render a text input with an optional leading icon; input attributes pass through. */
export const Input = forwardRef<HTMLInputElement, { icon?: ReactNode; className?: string } & InputHTMLAttributes<HTMLInputElement>>(
  function Input({ icon, className, ...rest }, ref) {
    return (
      <span className={className === undefined ? css.rpInputWrap : `${css.rpInputWrap} ${className}`}>
        {icon != null && <span className={css.rpInputIcon}>{icon}</span>}
        <input ref={ref} className={css.rpInput} {...rest} />
      </span>
    )
  },
)
