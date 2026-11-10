import { afterEach, describe, expect, it, vi } from 'vitest'
import { onPageVisible, pageVisible } from '../../src/client/visibility.ts'
import { clearPage, fakePage, show, withPage } from '../support/page.ts'

afterEach(() => { clearPage() })

describe('pageVisible', () => {
  it('counts a page that is not hidden, and a page that is missing at all, as visible', () => {
    expect(pageVisible()).toBe(true)
    withPage(fakePage('visible'))
    expect(pageVisible()).toBe(true)
    withPage(fakePage('hidden'))
    expect(pageVisible()).toBe(false)
  })
})

describe('onPageVisible', () => {
  it('wakes when the page comes back on screen, and not while it is still hidden', () => {
    const page = withPage(fakePage('hidden'))
    const wake = vi.fn()
    onPageVisible(wake)
    show(page)
    expect(wake).not.toHaveBeenCalled()
    page.visibilityState = 'visible'
    show(page)
    expect(wake).toHaveBeenCalledTimes(1)
  })

  it('stops waking once the disposer ran', () => {
    const page = withPage(fakePage('visible'))
    const wake = vi.fn()
    const off = onPageVisible(wake)
    expect(page.listeners.size).toBe(1)
    off()
    expect(page.listeners.size).toBe(0)
    show(page)
    expect(wake).not.toHaveBeenCalled()
  })

  it('does nothing without a document, as in a test or a prerender', () => {
    expect(() => { onPageVisible(() => undefined)() }).not.toThrow()
  })
})
