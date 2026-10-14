/** The part of `react-dom` the client uses; the shell provides the module at run time. */
declare module 'react-dom' {
  import type { ReactNode, ReactPortal } from 'react'
  export function createPortal(children: ReactNode, container: Element): ReactPortal
}
