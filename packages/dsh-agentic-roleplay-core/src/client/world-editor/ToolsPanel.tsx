import { useEffect, useState } from 'react'
import type { Switchboard } from '../../shared/settings.ts'
import type { Translate } from './WorldEditor.tsx'
import { loadInfo, saveInfo } from './world-files-api.ts'
import type { ExternalTool } from '../../shared/tools.ts'
import { loadExternalTools } from '../widgets/tool-switches/tools-api.ts'
import { ToolSwitches } from '../widgets/tool-switches/ToolSwitches.tsx'
import type { ToolSwitchKey } from '../widgets/tool-switches/locales.ts'
import css from './CharactersPanel.module.css'

/** The optional tools the world's agents have, kept in `world.json` and given to every story started from the world; a story can change them for itself later. */
export function ToolsPanel({ t, worldId, actions }: { t: Translate; worldId: string; actions: React.ReactNode }) {
  const [board, setBoard] = useState<Switchboard>()
  const [external, setExternal] = useState<ExternalTool[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    const abort = new AbortController()
    loadInfo(worldId, abort.signal).then((info) => { setBoard(info.tools) }, (failure: unknown) => { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)) })
    loadExternalTools(abort.signal).then(setExternal, () => undefined)
    return () => { abort.abort() }
  }, [worldId])

  if (board === undefined) return <p className={css.empty} role={error === undefined ? undefined : 'alert'}>{error === undefined ? t('editorLoading') : t('saveFailed', { message: error })}</p>
  const change = (next: Switchboard): void => {
    setBusy(true)
    setError(undefined)
    saveInfo(worldId, { tools: next }, new AbortController().signal).then(
      (info) => { setBoard(info.tools) },
      (failure: unknown) => { setError(failure instanceof Error ? failure.message : String(failure)) },
    ).finally(() => { setBusy(false) })
  }
  return (
    <div className={css.panel} data-testid="roleplay-world-tools">
      <div className={css.tabs}><span className={css.tabsSpace} />{actions}</div>
      <div className={css.body}>
        <article className={css.sheet}>
          <ToolSwitches board={board} onChange={change} disabled={busy} external={external} {...(error === undefined ? {} : { error })} t={t as unknown as (key: ToolSwitchKey, values?: Record<string, string>) => string} />
        </article>
      </div>
    </div>
  )
}
