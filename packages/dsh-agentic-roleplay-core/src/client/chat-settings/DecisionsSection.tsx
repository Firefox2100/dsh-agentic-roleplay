import { useCallback, useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { DECISION_SITES, type DecisionsPayload, type DecisionSite, type ExtraMode, type GateMode } from '../../shared/decisions.ts'
import type { ChatSettingsLocaleKey } from './locales.ts'
import { agreement, perRun } from './decision-figures.ts'
import { loadDecisions } from './settings-api.ts'
import css from './ChatSettingsView.module.css'

type Translate = (key: ChatSettingsLocaleKey, values?: Record<string, string | number>) => string

const MODE_LABEL = { off: 'decisionOff', llm: 'decisionLlm', decision: 'decisionDecision', hybrid: 'decisionHybrid', shadow: 'decisionShadow', on: 'decisionOn' } as const
const SITE_LABEL = { triggers: 'decisionsSiteTriggers', reflection: 'decisionsSiteReflection', agency: 'decisionsSiteAgency', refusal: 'decisionsSiteRefusal', rules: 'decisionsSiteRules', secrets: 'decisionsSiteSecrets' } as const

/** Whether a decision model is there, and how the sites set to use one have done in this story. */
export function DecisionsSection({ t, session, modes }: { t: Translate; session: string; modes: Record<DecisionSite, GateMode | ExtraMode> }) {
  const [payload, setPayload] = useState<DecisionsPayload | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback((): void => {
    setRefreshing(true)
    setError(undefined)
    loadDecisions(session, new AbortController().signal).then(
      (next) => { setPayload(next); setError(undefined) },
      (failure: unknown) => { setError(failure instanceof Error ? failure.message : String(failure)) },
    ).finally(() => { setRefreshing(false) })
  }, [session])
  useEffect(() => {
    const abort = new AbortController()
    loadDecisions(session, abort.signal).then(
      (next) => { setPayload(next); setError(undefined) },
      (failure: unknown) => { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)) },
    )
    return () => { abort.abort() }
  }, [session])

  return (
    <details className={css.activity} data-testid="roleplay-decisions">
      <summary>{t('decisionsTitle')}</summary>
      <div className={css.activityBody}>
        <p className={css.description}>{t('decisionsHelp')}</p>
        {payload === undefined && error === undefined && <p className={css.description} role="status">{t('decisionsLoading')}</p>}
        {error !== undefined && <p className={css.error} role="alert">{t('loadFailed', { message: error })}</p>}
        {payload !== undefined && (
          <>
          <p className={css.description}>{payload.available ? t('decisionsAvailable', { provider: payload.provider ?? '', model: payload.model ?? '' }) : t('decisionsUnavailable')}</p>
          <div className={css.tableViewport} role="region" aria-label={t('decisionsTableLabel')} tabIndex={0}>
            <table className={css.table}>
              <thead><tr><th scope="col">{t('decisionsSite')}</th><th scope="col">{t('decisionsMode')}</th><th scope="col">{t('decisionsRuns')}</th><th scope="col">{t('decisionsItems')}</th><th scope="col">{t('decisionsDecided')}</th><th scope="col">{t('decisionsEscalated')}</th><th scope="col">{t('decisionsFallbacks')}</th><th scope="col">{t('decisionsAgreement')}</th><th scope="col">{t('decisionsDecisionTime')}</th><th scope="col">{t('decisionsLlmTime')}</th></tr></thead>
              <tbody>
                {DECISION_SITES.map((site) => {
                  const stats = payload.stats.sites[site]
                  return (
                    <tr key={site} data-testid={`roleplay-decisions-${site}`}>
                      <th scope="row">{t(SITE_LABEL[site])}</th>
                      <td>{t(MODE_LABEL[modes[site]])}</td>
                      <td>{stats.runs}</td><td>{stats.items}</td><td>{stats.decided}</td><td>{stats.escalated}</td><td>{stats.fallbacks}</td>
                      <td>{agreement(stats)}</td><td>{perRun(stats.decisionMs, stats.runs)}</td><td>{perRun(stats.llmMs, stats.runs)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {DECISION_SITES.flatMap(site => (payload.stats.sites[site].problem === undefined ? [] : [<p key={`${site}-problem`} className={css.error} role="alert">{t('decisionsProblem', { site: t(SITE_LABEL[site]), message: payload.stats.sites[site].problem ?? '' })}</p>]))}
          {DECISION_SITES.flatMap(site => payload.stats.sites[site].samples.length === 0 ? [] : [(
            <div key={`${site}-samples`}>
              <p className={css.description}>{t('decisionsSamples', { site: t(SITE_LABEL[site]) })}</p>
              <ul className={css.description}>
                {[...payload.stats.sites[site].samples].reverse().map(sample => <li key={`${sample.turn}-${sample.what}`}>{t('decisionsSample', { turn: sample.turn, what: sample.what, probability: Math.round(sample.probability * 100), decision: sample.decision ? t('decisionsYes') : t('decisionsNo'), llm: sample.llm ? t('decisionsYes') : t('decisionsNo') })}</li>)}
              </ul>
            </div>
          )])}
          <p className={css.description}>{t('decisionsSince', { since: payload.stats.since.slice(0, 10) })}</p>
          </>
        )}
        <div><Button variant="ghost" size="sm" disabled={refreshing} aria-busy={refreshing} onClick={refresh}>{t(refreshing ? 'decisionsRefreshing' : 'decisionsRefresh')}</Button></div>
      </div>
    </details>
  )
}
