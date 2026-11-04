import { useEffect, useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { MAX_PLAYTEST_TURNS, type PlaytestReport } from '../../../shared/playtest.ts'
import { playtestChoices, playtestStatus, startPlaytest, stopPlaytest, type PlaytestChoices, type PlaytestReading } from './playtest-api.ts'
import css from './StartSessionDialog.module.css'

type T = TranslateNS<'roleplay.worlds'>

const POLL_MS = 2000
const DEFAULT_TURNS = 3

function Report({ t, report }: { t: T; report: PlaytestReport }) {
  const list = (items: readonly string[]): string => (items.length === 0 ? t('pt_none') : items.join(', '))
  return (
    <div className={css.form} data-testid="roleplay-playtest-report">
      <p className={css.message}>{t('pt_summary', { played: report.played, asked: report.asked, seconds: report.seconds })}</p>
      <p className={css.message}>{t('pt_places', { visited: list(report.places.visited), unvisited: list(report.places.unvisited) })}</p>
      <p className={css.message}>{t('pt_triggers', { fired: list(report.triggers.fired), waiting: list(report.triggers.waiting) })}</p>
      {report.turns.length > 0 && <ol>{report.turns.map(turn => <li key={turn.turn}>{t('pt_turn', { player: turn.player, seconds: turn.seconds, place: turn.place })}</li>)}</ol>}
      {report.changes.length > 0 && <p className={css.message}>{t('pt_changes', { count: report.changes.length })}</p>}
      {report.changes.slice(0, 12).map((change, index) => <p key={index} className={css.message}>{change.subject}: {change.a ?? t('pt_nothing')} → {change.b ?? t('pt_nothing')}</p>)}
      {report.findings.length > 0 && <p className={css.message}>{t('pt_findings', { count: report.findings.length })}</p>}
      {report.findings.slice(0, 10).map((finding, index) => <p key={index} className={css.message}>{finding.severity}: {finding.message}</p>)}
      {report.refused.length > 0 && <p className={css.message}>{t('pt_refused', { count: report.refused.length })}</p>}
      {report.missing.length > 0 && <p className={css.message}>{t('pt_missing', { count: report.missing.length })}</p>}
      {report.missing.map((entry, index) => <p key={`m${index}`} className={css.message}>{t('pt_missingLookup', { turn: entry.turn, character: entry.character, about: entry.about })}</p>)}
      {report.refused.map((call, index) => <p key={index} className={css.message}>{t('pt_refusedCall', { turn: call.turn, tool: call.tool, note: call.note })}</p>)}
      {report.problems.map((problem, index) => <p key={index} className={css.error}>{problem}</p>)}
    </div>
  )
}

/**
 * Asks for a bounded test play of a world (who plays, how many turns), shows what it costs, runs it and reports. The test story is removed by the host afterwards and the world
 * is only read.
 */
export function PlaytestDialog({ t, worldId, worldName, onClose }: { t: T; worldId: string; worldName: string; onClose: () => void }) {
  const [reading, setReading] = useState<PlaytestReading>({ state: 'idle' })
  const [players, setPlayers] = useState<readonly { id: string; name: string }[]>()
  const [player, setPlayer] = useState('')
  const [choices, setChoices] = useState<PlaytestChoices>()
  const [opening, setOpening] = useState('')
  const [startTime, setStartTime] = useState('')
  const [turns, setTurns] = useState(String(DEFAULT_TURNS))
  const [error, setError] = useState<string>()
  const running = reading.state === 'running'

  useEffect(() => {
    const abort = new AbortController()
    playtestStatus(worldId, abort.signal).then(setReading, () => undefined)
    playtestChoices(worldId, abort.signal).then((found) => { setChoices(found); setPlayers(found.players); setPlayer(found.players[0]?.id ?? '') }, (failure: unknown) => { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)) })
    return () => { abort.abort() }
  }, [worldId])

  useEffect(() => {
    if (!running) return undefined
    const timer = setInterval(() => { playtestStatus(worldId).then(setReading, () => undefined) }, POLL_MS)
    return () => { clearInterval(timer) }
  }, [running, worldId])

  const count = Number(turns)
  const valid = Number.isInteger(count) && count >= 1 && count <= MAX_PLAYTEST_TURNS
  const chosenOpening = opening === '' ? undefined : choices?.openings[Number(opening)]
  const openingValid = chosenOpening !== undefined && (chosenOpening.character === undefined || chosenOpening.character === player)
  const begin = (): void => {
    setError(undefined)
    startPlaytest(worldId, { turns: count, ...(player === '' ? {} : { playerCharacterId: player }), ...(!openingValid ? {} : { opening: Number(opening) }), ...(startTime.trim() === '' ? {} : { startingTime: startTime.trim() }), language: t('language') }).then(setReading, (failure: unknown) => { setError(failure instanceof Error ? failure.message : String(failure)) })
  }
  const stop = (): void => { stopPlaytest(worldId).then(setReading, (failure: unknown) => { setError(failure instanceof Error ? failure.message : String(failure)) }) }

  return (
    <Modal open onClose={onClose} title={t('pt_title')} description={worldName} closeLabel={t('close')} footer={running
      ? <><Button variant="ghost" onClick={onClose}>{t('close')}</Button><Button variant="primary" onClick={stop}>{t('pt_stop')}</Button></>
      : <><Button variant="ghost" onClick={onClose}>{t('close')}</Button><Button variant="primary" disabled={!valid || players?.length === 0} onClick={begin}>{t('pt_start')}</Button></>}>
      <div className={css.form}>
        {!running && reading.state !== 'done' && reading.state !== 'stopped' && (
          <>
            <p className={css.message}>{t('pt_help', { max: MAX_PLAYTEST_TURNS })}</p>
            {players?.length === 0 && <p className={css.error}>{t('pt_noPlayer')}</p>}
            {players !== undefined && players.length > 1 && (
              <label className={css.field}>
                <span>{t('playAs')}</span>
                <select value={player} onChange={(event) => { setPlayer(event.target.value) }}>{players.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
              </label>
            )}
            {choices?.openings.some(entry => entry.character === undefined || entry.character === player) === true && (
              <label className={css.field}>
                <span>{t('startOpening')}</span>
                <select value={openingValid ? opening : ''} onChange={(event) => { setOpening(event.target.value) }}>
                  <option value="">{t('startOpeningDefault')}</option>
                  {choices.openings.flatMap((entry, index) => (entry.character === undefined || entry.character === player ? [<option key={index} value={String(index)}>{entry.title}</option>] : []))}
                </select>
              </label>
            )}
            <label className={css.field}>
              <span>{t('startTime')}</span>
              <Input value={startTime} placeholder={choices?.startingTime === '' || choices === undefined ? 'YYYY-MM-DDTHH:MM:SS' : choices.startingTime} onChange={(event) => { setStartTime(event.target.value) }} />
              <span>{t('startTimeHelp', { zone: choices?.timeZone ?? '' })}</span>
            </label>
            <label className={css.field}>
              <span>{t('pt_turns')}</span>
              <Input value={turns} inputMode="numeric" onChange={(event) => { setTurns(event.target.value) }} />
            </label>
            <p className={css.message}>{valid ? t('pt_cost', { turns: count }) : t('pt_turnsInvalid', { max: MAX_PLAYTEST_TURNS })}</p>
          </>
        )}
        {running && <p className={css.message} role="status">{t('pt_running', { played: reading.played, turns: reading.turns, step: reading.step })}</p>}
        {reading.state === 'failed' && <p className={css.error} role="alert">{t('pt_failed', { message: reading.error ?? '' })}</p>}
        {(reading.state === 'done' || reading.state === 'stopped') && reading.error !== undefined && <p className={css.error} role="alert">{reading.error}</p>}
        {(reading.state === 'done' || reading.state === 'stopped') && reading.report !== undefined && <Report t={t} report={reading.report} />}
        {(reading.state === 'done' || reading.state === 'stopped' || reading.state === 'failed') && <Button variant="outline" size="sm" onClick={() => { setReading({ state: 'idle' }) }}>{t('pt_again')}</Button>}
        {error !== undefined && <p className={css.error} role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
