import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { Note } from '../../shared/notes.ts'
import css from './SuggestionsDock.module.css'
import { NARRATION_NODE } from './definitions.ts'

/** What the dock does besides showing: put a suggestion into the input box, and ask the host for the notes of the turn. */
export interface SuggestionsInjected {
  pick: (text: string) => void
  notes: () => Promise<Note[]>
}

export type SuggestionsDockProps = PropsRuntime<'conversation.input.dock'> & SuggestionsInjected & PropsLocale<'roleplay.transcript'>

interface NodeLike {
  kind?: string
  anchorSeq?: number
}

/** The suggestions are made after the output is shown, so they are asked for until they are there. */
const POLL_MS = 2000
const GIVE_UP_AFTER = 45

/**
 * What the player could do next, as chips stacked above the input; clicking one fills the input (the player may
 * edit it before sending). They are made in the background once the output of a turn is shown, so the dock asks
 * the host for them for a while. Shown only while they are the latest thing in the chat: once the player has sent
 * something, or a turn is running, they are gone.
 */
export function SuggestionsDock({ useChat, useSession, pick, notes, t }: SuggestionsDockProps) {
  const running = useSession(session => session.running)
  const latest = useChat((chat) => {
    const nodes = [...(chat.nodes.values() as Iterable<NodeLike>)]
    const output = nodes.filter(node => node.kind === NARRATION_NODE).reduce<NodeLike | undefined>((best, node) => ((node.anchorSeq ?? 0) >= (best?.anchorSeq ?? -1) ? node : best), undefined)
    if (output === undefined) return undefined
    const newer = nodes.some(node => node.kind !== NARRATION_NODE && (node.anchorSeq ?? 0) > (output.anchorSeq ?? 0) && node.kind !== undefined && /user|message/.test(node.kind))
    return newer ? undefined : output.anchorSeq
  })
  const [offered, setOffered] = useState<readonly string[]>([])

  useEffect(() => {
    setOffered([])
    if (latest === undefined) return undefined
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const look = (attempt: number): void => {
      notes().then((found) => {
        if (stopped) return
        const lines = found.find(note => note.kind === 'suggestions')?.lines
        if (lines !== undefined && lines.length > 0) setOffered(lines)
        else if (attempt < GIVE_UP_AFTER) timer = setTimeout(() => { look(attempt + 1) }, POLL_MS)
      }).catch((error: unknown) => { console.warn('roleplay: the notes could not be read', error) })
    }
    look(0)
    return () => { stopped = true; if (timer !== undefined) clearTimeout(timer) }
  }, [latest, notes])

  if (running || offered.length === 0) return null
  return (
    <div className={css.dock} data-testid="roleplay-suggestions">
      <span className={css.label}>{t('suggestions')}</span>
      {offered.map(text => (
        <button key={text} type="button" className={css.chip} title={t('suggestionHint')} onClick={() => { pick(text) }}>{text}</button>
      ))}
    </div>
  )
}
