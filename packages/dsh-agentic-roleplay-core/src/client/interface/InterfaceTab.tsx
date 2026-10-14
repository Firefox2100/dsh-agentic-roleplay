import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { roleplaySessionOf } from '../../shared/chat.ts'
import { usePack, usePlayerView } from './hooks.ts'
import { PackFrame, type FrameInput } from './PackFrame.tsx'
import css from './PackFrame.module.css'

export interface InterfaceTabInjected {
  frameInput: (sessionId: string) => FrameInput
}

export type InterfaceTabProps = PropsRuntime<'conversation.view'> & InterfaceTabInjected & PropsLocale<'roleplay.interface'>

/** The tab of the story's interface pack: a page of its own beside Chat. */
export function InterfaceTab({ sessionId, frameInput, t }: InterfaceTabProps) {
  const session = roleplaySessionOf(sessionId)
  const payload = usePack(session)
  const pack = payload?.pack ?? undefined
  const tab = pack?.surfaces.tab
  const view = usePlayerView(session, tab !== undefined)
  if (session === undefined) return <p className={css.message}>{t('notRoleplay')}</p>
  if (payload === undefined) return null
  if (pack === undefined) {
    return (
      <div className={css.message}>
        {payload.problems.length === 0 ? t('noPack') : t('problems')}
        {payload.problems.length > 0 && <ul className={css.problems}>{payload.problems.map((problem, index) => <li key={index}>{problem.file === '' ? problem.message : `${problem.file}: ${problem.message}`}</li>)}</ul>}
      </div>
    )
  }
  if (tab === undefined) return <p className={css.message}>{t('noTab')}</p>
  return (
    <div className={css.tab} data-rp="tab">
      <PackFrame session={session} pack={pack} surface="tab" view={view} input={frameInput(sessionId)} fill title={tab.title === '' ? pack.name : tab.title} />
    </div>
  )
}
