import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { Note } from '../../shared/notes.ts'
import { onPageVisible, pageVisible } from '../visibility.ts'
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
/** Messages from characters arrive while nobody is playing, so they are looked for all the while the dock is open, slowly. */
const MESSAGE_POLL_MS = 30_000

/**
 * What the player could do next, as chips stacked above the input; clicking one fills the input (the player may
 * edit it before sending). They are made in the background once the output of a turn is shown, so the dock asks
 * the host for them for a while. What other characters did meanwhile (the `away` note) is a card above them, from the same notes; what the world check found at the start (the `world` note) is another. Shown only while they are the latest thing in the chat: once the player has sent
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
  const [meanwhile, setMeanwhile] = useState<readonly string[]>([])
  const [unfinished, setUnfinished] = useState<readonly string[]>([])
  const [unwritten, setUnwritten] = useState(0)
  const [messages, setMessages] = useState<readonly string[]>([])

  useEffect(() => {
    let stopped = false
    const look = (): void => {
      notes().then((found) => {
        if (stopped) return
        const lines = found.find(note => note.kind === 'message')?.lines ?? []
        setMessages(previous => (previous.join('\n') === lines.join('\n') ? previous : lines))
      }).catch((error: unknown) => { console.warn('roleplay: the notes could not be read', error) })
    }
    look()
    const timer = setInterval(() => { if (pageVisible()) look() }, MESSAGE_POLL_MS)
    // A message from a character may have arrived while the page was in the background.
    const off = onPageVisible(look)
    return () => { stopped = true; clearInterval(timer); off() }
  }, [notes])

  useEffect(() => {
    setOffered([])
    setMeanwhile([])
    setUnfinished([])
    setUnwritten(0)
    if (latest === undefined) return undefined
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const look = (attempt: number): void => {
      // A tab in the background does not spend its attempts: the suggestions can wait for the player to come back.
      if (!pageVisible()) { timer = setTimeout(() => { look(attempt) }, POLL_MS); return }
      notes().then((found) => {
        if (stopped) return
        const away = found.find(note => note.kind === 'away')?.lines ?? []
        setMeanwhile(previous => (previous.join('\n') === away.join('\n') ? previous : away))
        const world = found.find(note => note.kind === 'world')?.lines ?? []
        setUnfinished(previous => (previous.join('\n') === world.join('\n') ? previous : world))
        const waiting = found.find(note => note.kind === 'unwritten')?.count ?? 0
        setUnwritten(waiting)
        const lines = found.find(note => note.kind === 'suggestions')?.lines
        if (lines !== undefined && lines.length > 0) setOffered(lines)
        if ((lines === undefined || lines.length === 0 || waiting > 0) && attempt < GIVE_UP_AFTER) timer = setTimeout(() => { look(attempt + 1) }, POLL_MS)
      }).catch((error: unknown) => { console.warn('roleplay: the notes could not be read', error) })
    }
    look(0)
    return () => { stopped = true; if (timer !== undefined) clearTimeout(timer) }
  }, [latest, notes])

  if (running || (offered.length === 0 && meanwhile.length === 0 && unfinished.length === 0 && unwritten === 0 && messages.length === 0)) return null
  return (
    <div className={css.dock} data-testid="roleplay-suggestions" data-rp="suggestions">
      {unwritten > 0 && <span className={css.label} data-testid="roleplay-unwritten">{t('unwritten', { count: unwritten })}</span>}
      {unfinished.length > 0 && (
        <div className={css.card} data-testid="roleplay-world-findings">
          <span className={css.label}>{t('worldFindings')}</span>
          <ul className={css.lines}>{unfinished.map(line => <li key={line}>{line}</li>)}</ul>
        </div>
      )}
      {messages.length > 0 && (
        <div className={css.card} data-testid="roleplay-messages">
          <span className={css.label}>{t('messagesAway')}</span>
          <ul className={css.lines}>{messages.map(line => <li key={line}>{line}</li>)}</ul>
        </div>
      )}
      {meanwhile.length > 0 && (
        <div className={css.card} data-testid="roleplay-meanwhile">
          <span className={css.label}>{t('meanwhile')}</span>
          <ul className={css.lines}>{meanwhile.map(line => <li key={line}>{line}</li>)}</ul>
        </div>
      )}
      {offered.length > 0 && <span className={css.label}>{t('suggestions')}</span>}
      {offered.map(text => (
        <button key={text} type="button" className={css.chip} data-rp="suggestion" title={t('suggestionHint')} onClick={() => { pick(text) }}>{text}</button>
      ))}
    </div>
  )
}
