import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../../panel/slot-contract.ts'

export type SessionsPageProps = PropsRuntime<'roleplay.page'> & PropsLocale<'roleplay.sessions'>

export function SessionsPage({ t }: SessionsPageProps) {
  return <div aria-label={t('nav')} data-testid="roleplay-sessions-page" />
}
