/** The part of an element this needs, so that it can be checked without a page. */
export interface ElementLike {
  parentElement: ElementLike | null
  querySelector(selector: string): ElementLike | null
}

/**
 * The element that holds a session's transcript and what is drawn behind it, found from something inside the same
 * conversation: the closest ancestor that contains the scrolling body of the chat, and that body's parent.
 */
export function conversationBody<T extends ElementLike>(from: T): { body: T; scroll: T } | undefined {
  for (let at = from.parentElement as T | null; at !== null; at = at.parentElement as T | null) {
    const scroll = at.querySelector('[class*="_scrollBody"]') as T | null
    if (scroll?.parentElement != null) return { body: scroll.parentElement as T, scroll }
  }
  return undefined
}
