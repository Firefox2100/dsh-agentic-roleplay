import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { authoredWorldOf } from '../../shared/authoring-chat.ts'
import type { CardPieceView, CardView } from '../../shared/card-view.ts'
import { Tag } from '../ui/Tag.tsx'
import { Input } from '../ui/Input.tsx'
import { Button } from '../ui/Button.tsx'
import { IconBrowse, IconChevronLeft } from '../ui/icons.tsx'
import { SidebarGuideEntry } from '../widgets/sidebar-guide/SidebarGuideEntry.tsx'
import { loadCard, loadPiece } from './card-api.ts'
import css from './CardTab.module.css'

/** The kind of the tab type, and the identity it registers its card and body under. */
export const CARD_KIND = 'roleplay-card'
export const CARD_ID = '@dsh-agentic-roleplay/core/card-sidebar'

export type CardBodyProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'roleplay.card'> & InjectFace<Record<string, never>> & { sessionId: string }
export type CardGuideProps = PropsRuntime<'sidebar.right.tab.guide.entry'> & PropsLocale<'roleplay.card'> & { sessionId: string }
type T = CardBodyProps['t']

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function Piece({ piece, world, t }: { piece: CardPieceView; world: string; t: T }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState<string | { failed: string }>()
  useEffect(() => {
    if (!open || text !== undefined) return
    const abort = new AbortController()
    loadPiece(world, piece.id, abort.signal).then(read => { setText(read.text) }, (failure: unknown) => { if (!abort.signal.aborted) setText({ failed: messageOf(failure) }) })
    return () => { abort.abort() }
  }, [open, text, world, piece.id])
  return (
    <li className={`${css.item} ${piece.enabled === false ? css.off : ''}`} data-testid="roleplay-card-piece">
      <button type="button" className={css.head} aria-expanded={open} onClick={() => { setOpen(!open) }}>
        <span className={css.id}>{piece.id}</span>
        <span className={css.title}>{piece.title === '' ? piece.label : piece.title}</span>
        <span className={css.meta}>{t('chars', { count: piece.length })}</span>
        <Tag>{piece.used ? t('used') : t('unused')}</Tag>
        {piece.enabled === false && <Tag>{t('off')}</Tag>}
        {piece.roles.map(role => <Tag key={role}>{role}</Tag>)}
      </button>
      {!open && <p className={css.start}>{piece.start}</p>}
      {open && (
        <>
          <p className={css.note}>{piece.keys.length === 0 ? t('noKeys') : t('keys', { keys: piece.keys.join(', ') })}</p>
          {text === undefined ? <p className={css.note}>{t('loading')}</p> : typeof text === 'string' ? <pre className={css.text}>{text}</pre> : <p className={css.error} role="alert">{t('readFailed', { message: text.failed })}</p>}
        </>
      )}
    </li>
  )
}

/** Whether the authoring chat's world keeps a source card; false while it is being read, and for any other chat. */
function useHasCard(world: string | undefined): boolean {
  const [has, setHas] = useState(false)
  useEffect(() => {
    if (world === undefined) { setHas(false); return }
    const abort = new AbortController()
    loadCard(world, abort.signal).then(card => { setHas(card.present) }, () => { setHas(false) })
    return () => { abort.abort() }
  }, [world])
  return has
}

/** The guide entry that opens the card; only the authoring chat of a world that has one shows it. */
export function CardGuide({ sessionId, useTabInfo, t }: CardGuideProps): ReactNode {
  const { tab } = useTabInfo()
  const has = useHasCard(authoredWorldOf(sessionId))
  if (!has) return null
  return <SidebarGuideEntry kind={CARD_KIND} title={t('tab')} description={t('guideText')} icon={IconBrowse} onOpen={() => { tab.actions.openTab(CARD_KIND, { replaceTab: true }) }} />
}

/** The card a world was imported from, with the ids the assistant names its pieces by, readable beside the world. */
export function CardBody({ t, sessionId, useTabInfo }: CardBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const world = authoredWorldOf(sessionId)
  const [card, setCard] = useState<CardView | { failed: string }>()
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (world === undefined) return
    const abort = new AbortController()
    loadCard(world, abort.signal).then(setCard, (failure: unknown) => { if (!abort.signal.aborted) setCard({ failed: messageOf(failure) }) })
    return () => { abort.abort() }
  }, [world])
  const pieces = useMemo(() => {
    if (card === undefined || 'failed' in card) return []
    const needle = query.trim().toLowerCase()
    return needle === '' ? card.pieces : card.pieces.filter(piece => [piece.id, piece.title, piece.label, piece.start, ...piece.keys, ...piece.roles].some(text => text.toLowerCase().includes(needle)))
  }, [card, query])
  const back = <div className={css.top}><Button variant="ghost" size="sm" icon={<IconChevronLeft />} onClick={() => { tab.actions.openTab('guide', { replaceTab: true }) }}>{t('back')}</Button></div>
  const message = (text: string, error = false): ReactNode => <div className={css.frame}>{back}{error ? <p className={css.error} role="alert">{text}</p> : <p className={css.note}>{text}</p>}</div>

  if (world === undefined) return message(t('notAuthoring'))
  if (card === undefined) return message(t('loading'))
  if ('failed' in card) return message(t('failed', { message: card.failed }), true)
  if (!card.present) return message(t('none'))
  return (
    <div className={css.frame} data-testid="roleplay-card">
      {back}
      <div className={css.page}>
        <p className={css.note}>{t('help')}{card.creator === undefined || card.creator === '' ? '' : ` ${t('by', { creator: card.creator })}`}</p>
        <div className={css.bar}>
          <Input value={query} aria-label={t('search')} placeholder={t('search')} onChange={(event) => { setQuery(event.target.value) }} />
          <span className={css.meta}>{t('count', { shown: pieces.length, total: card.pieces.length })}</span>
        </div>
        <ul className={css.list}>{pieces.map(piece => <Piece key={piece.id} piece={piece} world={world} t={t} />)}</ul>
      </div>
    </div>
  )
}
