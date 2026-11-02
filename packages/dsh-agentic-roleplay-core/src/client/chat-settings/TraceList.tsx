import type { ActivityEntry } from '../../shared/activity.ts'
import type { CharacterAccess, PromptPart, TurnTrace } from '../../shared/trace.ts'
import type { ChatSettingsLocaleKey } from './locales.ts'
import { KIND_IDS, PART_IDS, SECTION_IDS } from './trace-locales.ts'
import { LOOKUP_TOOLS, fullestRequest, refusalsOf, turnTimes } from './turn-times.ts'
import css from './ChatSettingsView.module.css'

type Translate = (key: ChatSettingsLocaleKey, values?: Record<string, string | number>) => string

/** How many of the latest turns are listed. */
const SHOWN = 10

const seconds = (ms: number): string => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
const count = (value: number): string => value.toLocaleString()

export const labelOf = (t: Translate, prefix: 'tracePart_' | 'traceSection_', id: string, known: readonly string[]): string => (known.includes(id) ? t(`${prefix}${id}` as ChatSettingsLocaleKey) : id)
export const sizes = (t: Translate, prefix: 'tracePart_' | 'traceSection_', known: readonly string[], parts: readonly PromptPart[]): string => parts.map(part => `${labelOf(t, prefix, part.id, known)} ~${count(part.tokens)}`).join(' · ')

type Kind = typeof KIND_IDS[number]
const kindText = (t: Translate, kind: Kind, value: number): string => `${value} ${t(`traceKind_${kind}`)}`

const nonzero = (t: Translate, counts: Partial<Record<Kind, number>>): string[] => (Object.entries(counts) as [Kind, number][]).filter(([, value]) => value > 0).map(([kind, value]) => kindText(t, kind, value))

function givenText(t: Translate, access: CharacterAccess): string {
  const { memories, ...counts } = access.given
  return [t('traceMemories', memories), ...nonzero(t, counts)].join(' · ')
}

const withheldText = (t: Translate, access: CharacterAccess): string => nonzero(t, access.withheld).join(' · ')

function TurnBody({ t, trace, activity }: { t: Translate; trace: TurnTrace; activity: readonly ActivityEntry[] }) {
  const times = turnTimes(trace, activity)
  const refusals = refusalsOf(trace, times.helpers)
  const fullest = fullestRequest(trace)
  const lookups = (trace.calls ?? []).filter(call => LOOKUP_TOOLS.includes(call.tool))
  const nothingRefused = refusals.calls.length === 0 && refusals.steered.length === 0 && refusals.helpers.length === 0 && refusals.cutOff.length === 0
  return (
    <div className={css.run} data-testid="roleplay-trace-turn">
      <p className={css.description}><strong>{t('traceTimeTitle')}</strong></p>
      <ul className={css.reasons}>
        <li>{t('traceWaited', { time: seconds(times.beforeMs) })}</li>
        <li>{t('traceModel', { time: seconds(times.modelMs) })}</li>
        {times.tools.slice(0, 4).map(tool => <li key={tool.tool}>{t('traceToolTime', { tool: tool.tool, time: seconds(tool.ms), count: tool.calls })}</li>)}
        {times.helpers.map(helper => <li key={helper.label}>{t('traceHelperTime', { label: helper.label, front: seconds(helper.foregroundMs), back: seconds(helper.backgroundMs), runs: helper.runs })}</li>)}
        {times.backgroundMs > 0 && <li>{t('traceBackground', { time: seconds(times.backgroundMs) })}</li>}
      </ul>

      {fullest !== undefined && (
        <>
          <p className={css.description}><strong>{t('tracePromptTitle')}</strong></p>
          <ul className={css.reasons} data-testid="roleplay-trace-prompt">
            <li>{fullest.prompt === undefined ? sizes(t, 'tracePart_', PART_IDS, fullest.parts) : `${t('tracePromptSize', { step: fullest.step, count: count(fullest.prompt) })}: ${sizes(t, 'tracePart_', PART_IDS, fullest.parts)}`}</li>
            {trace.scene !== undefined && trace.scene.length > 0 && <li>{`${t('traceSceneTitle')}: ${sizes(t, 'traceSection_', SECTION_IDS, [...trace.scene].sort((a, b) => b.tokens - a.tokens))}`}</li>}
          </ul>
        </>
      )}

      <p className={css.description}><strong>{t('traceRefusalTitle')}</strong></p>
      {nothingRefused
        ? <p className={css.description}>{t('traceNoRefusal')}</p>
        : (
          <ul className={css.reasons} data-testid="roleplay-trace-refusals">
            {refusals.calls.map((call, index) => <li key={`c${index}`}>{t('traceRefusedCall', { tool: call.tool, reason: call.note })}</li>)}
            {refusals.steered.map((text, index) => <li key={`s${index}`}>{t('traceSteered', { text })}</li>)}
            {refusals.helpers.map(helper => <li key={helper.label}>{t('traceHelperRefused', { label: helper.label, count: helper.refused })}</li>)}
            {refusals.cutOff.map(step => <li key={`o${step}`}>{t('traceCutOff', { step })}</li>)}
          </ul>
        )}

      {trace.selected !== undefined && (
        <>
          <p className={css.description}><strong>{t('traceRemindedTitle')}</strong></p>
          <ul className={css.reasons} data-testid="roleplay-trace-reminded">
            {trace.selected.folded === 0
              ? <li>{t('traceNothingFolded')}</li>
              : trace.selected.events.length === 0
                ? <li>{t('traceNoneReminded')}</li>
                : trace.selected.events.map((event, index) => <li key={index}>{`(${event.turn}) ${event.text} — ${t(event.how === 'search' ? 'traceRemindedSearch' : 'traceRemindedCues')}`}</li>)}
            {trace.selected.folded > 0 && trace.selected.omitted > 0 && <li>{t('traceLeftOut', { omitted: trace.selected.omitted, folded: trace.selected.folded })}</li>}
          </ul>
        </>
      )}

      {lookups.length > 0 && (
        <>
          <p className={css.description}><strong>{t('traceLookups')}</strong></p>
          <ul className={css.reasons}>{lookups.map((call, index) => <li key={index} className={call.failed ? css.error : undefined}>{t('traceLookupRow', { tool: call.tool, text: call.note })}</li>)}</ul>
        </>
      )}

      {trace.access !== undefined && trace.access.length > 0 && (
        <>
          <p className={css.description}><strong>{t('traceCharactersTitle')}</strong></p>
          <p className={css.description}>{t('traceCharactersHelp')}</p>
          <table className={css.table} data-testid="roleplay-trace-access">
            <thead><tr><th /><th>{t('traceGiven')}</th><th>{t('traceWithheld')}</th></tr></thead>
            <tbody>
              {trace.access.map((access, index) => (
                <tr key={index}>
                  <td>{access.attempt > 1 ? `${access.character} (${t('traceRetry')})` : access.character}</td>
                  <td>{givenText(t, access)}</td>
                  <td>
                    {withheldText(t, access)}
                    {access.names !== undefined && <div className={css.description}>{t('traceNames', { names: Object.values(access.names).flat().join(', ') })}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

/** Where each of the latest turns went, newest first: the time before and after delivery, the game master's prompt by part, what was refused, what it was reminded of, and what each character was given. */
export function TraceList({ t, trace, activity }: { t: Translate; trace: readonly TurnTrace[]; activity: readonly ActivityEntry[] }) {
  const shown = trace.slice(-SHOWN).reverse()
  return (
    <details className={css.activity} data-testid="roleplay-trace">
      <summary>{t('traceTitle')}</summary>
      <p className={css.description}>{t('traceHelp')}</p>
      {shown.length === 0
        ? <p className={css.description}>{t('traceEmpty')}</p>
        : shown.map((entry) => {
          const times = turnTimes(entry, activity)
          const refused = refusalsOf(entry, times.helpers)
          const total = refused.calls.length + refused.helpers.reduce((sum, helper) => sum + helper.refused, 0)
          return (
            <details key={entry.turn}>
              <summary>{entry.endedAt === undefined ? t('traceUnfinished', { turn: entry.turn }) : t('traceSummary', { turn: entry.turn, front: seconds(times.foregroundMs), back: seconds(times.backgroundMs), refused: total })}</summary>
              <TurnBody t={t} trace={entry} activity={activity} />
            </details>
          )
        })}
    </details>
  )
}
