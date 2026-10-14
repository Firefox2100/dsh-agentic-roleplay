import { describe, expect, it } from 'vitest'
import { conversationBody } from '../../../src/client/interface/conversation-body.ts'

interface Fake { name: string; parentElement: Fake | null; scroll?: Fake; querySelector(selector: string): Fake | null }
const node = (name: string, parent: Fake | null, scroll?: Fake): Fake => ({ name, parentElement: parent, ...(scroll === undefined ? {} : { scroll }), querySelector(selector) { return selector.includes('_scrollBody') ? this.scroll ?? null : null } })

describe('finding the body of the chat that a dock stands in', () => {
  it('is the parent of the scrolling body, found from the closest ancestor that holds one', () => {
    const root = node('root', null)
    const body = node('body', root)
    const scroll = node('scroll', body)
    root.scroll = scroll
    const seat = node('seat', root)
    const dock = node('dock', seat)
    const found = conversationBody(dock)!
    expect(found.body.name).toBe('body')
    expect(found.scroll.name).toBe('scroll')
  })

  it('is nothing when the page has no such body, which leaves the story without a backdrop', () => {
    const root = node('root', null)
    expect(conversationBody(node('dock', root))).toBeUndefined()
  })
})
