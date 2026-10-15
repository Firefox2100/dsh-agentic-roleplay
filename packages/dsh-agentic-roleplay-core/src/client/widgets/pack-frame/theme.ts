import type { ThemeData } from './bridge.ts'

/** The colours of DSH a surface is given, so that it looks right in light and dark. */
export const SHARED_TOKENS = [
  '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-border-l3', '--dsw-alias-border-l4',
  '--dsw-alias-brand-primary', '--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary',
  '--dsw-alias-link', '--dsw-alias-state-business-primary', '--dsw-alias-state-error-primary', '--dsw-alias-state-idle-primary',
  '--dsw-alias-state-success-primary', '--dsw-alias-state-warn-primary',
  '--dsw-radius-sm',
] as const

const DARK_ATTRIBUTE = 'data-ds-dark-theme'

/** The language of the interface: the page's own, else the browser's, else English. */
export function readLanguage(root: Element = document.documentElement): string {
  const written = root.getAttribute('lang') ?? (typeof navigator === 'undefined' ? '' : navigator.language)
  return /^[a-z]{2}/i.exec(written)?.[0]?.toLowerCase() ?? 'en'
}

/** The scheme, the language and the colours the page uses now. */
export function readTheme(body: Element = document.body): ThemeData {
  const style = getComputedStyle(body)
  const tokens: Record<string, string> = {}
  for (const name of SHARED_TOKENS) {
    const value = style.getPropertyValue(name).trim()
    if (value !== '') tokens[name] = value
  }
  return { scheme: body.hasAttribute(DARK_ATTRIBUTE) ? 'dark' : 'light', language: readLanguage(), tokens }
}

/** Calls back when the page changes its scheme, its language or its colours. @returns stop. */
export function watchTheme(callback: () => void, body: HTMLElement = document.body, root: HTMLElement = document.documentElement): () => void {
  const observer = new MutationObserver(callback)
  observer.observe(body, { attributes: true, attributeFilter: [DARK_ATTRIBUTE, 'style', 'class'] })
  observer.observe(root, { attributes: true, attributeFilter: ['lang'] })
  return () => { observer.disconnect() }
}
