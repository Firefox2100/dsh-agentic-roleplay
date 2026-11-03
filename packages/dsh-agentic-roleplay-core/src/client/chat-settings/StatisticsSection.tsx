import { useState } from 'react'
import type { StoryStatistics } from '../../shared/statistics.ts'
import { API_PREFIX } from '../../shared/worlds.ts'
import type { ChatSettingsLocaleKey } from './locales.ts'
import css from './ChatSettingsView.module.css'

type Translate = (key: ChatSettingsLocaleKey, values?: Record<string, string | number>) => string

async function loadStatistics(id: string): Promise<StoryStatistics> {
  const response = await fetch(`${API_PREFIX}/sessions/statistics?id=${encodeURIComponent(id)}`, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { message?: string }).message ?? `${response.status} ${response.statusText}`.trim())
  return await response.json() as StoryStatistics
}

const clock = (ms: number): string => { const seconds = Math.round(ms / 1000); return seconds < 120 ? `${seconds} s` : `${Math.round(seconds / 60)} min` }

/** How long a stretch of story time is, in the largest unit that keeps it readable. */
export function storySpan(seconds: number, t: Translate): string {
  if (seconds < 3600) return t('statsMinutes', { count: Math.round(seconds / 60) })
  if (seconds < 86_400 * 2) return t('statsHours', { count: Math.round(seconds / 360) / 10 })
  return t('statsDays', { count: Math.round(seconds / 8640) / 10 })
}

/** The shape of the played story: its length, the time it took and covers, who spoke, what is open, how it branched and what the models used. Read when opened. */
export function StatisticsSection({ t, session }: { t: Translate; session: string }) {
  const [stats, setStats] = useState<StoryStatistics | 'loading' | { error: string } | undefined>()
  const load = (): void => {
    setStats('loading')
    loadStatistics(session).then(setStats, (failure: unknown) => { setStats({ error: failure instanceof Error ? failure.message : String(failure) }) })
  }
  const total = stats !== undefined && stats !== 'loading' && !('error' in stats) ? stats.speaking.reduce((sum, voice) => sum + voice.length, 0) + stats.narration.length : 0
  return (
    <details className={css.activity} data-testid="roleplay-statistics" onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open && stats === undefined) load() }}>
      <summary>{t('statsTitle')}</summary>
      <p className={css.description}>{t('statsHelp')}</p>
      {stats === 'loading' && <p className={css.description}>{t('loading')}</p>}
      {stats !== undefined && stats !== 'loading' && 'error' in stats && <p className={css.error} role="alert">{t('statsFailed', { message: stats.error })}</p>}
      {stats !== undefined && stats !== 'loading' && !('error' in stats) && (
        <ul className={css.reasons}>
          <li>{t('statsTurns', { count: stats.turns })}</li>
          <li>{t('statsWaited', { time: clock(stats.realTime.waitedMs) })}</li>
          {stats.storyTime.elapsedSeconds !== undefined && <li>{t('statsStoryTime', { span: storySpan(stats.storyTime.elapsedSeconds, t) })}</li>}
          <li>{t('statsScenes', { count: stats.scenes })}</li>
          <li>{t('statsNarration', { passages: stats.narration.passages, share: total === 0 ? 0 : Math.round(stats.narration.length * 100 / total) })}</li>
          {stats.speaking.map(voice => <li key={voice.name}>{t('statsVoice', { name: voice.name, lines: voice.lines, share: total === 0 ? 0 : Math.round(voice.length * 100 / total) })}</li>)}
          <li>{t('statsThreads', { open: stats.threads.open, resolved: stats.threads.resolved })}</li>
          <li>{t('statsRelationships', { changed: stats.relationships.changed, total: stats.relationships.total })}</li>
          <li>{t('statsBranches', { points: stats.branches.branchPoints, aside: stats.branches.setAside })}</li>
          <li>{t('statsUsage', { runs: stats.usage.runs, master: stats.usage.masterTokens.toLocaleString(), helpers: stats.usage.helperTokens.toLocaleString() })}</li>
        </ul>
      )}
    </details>
  )
}
