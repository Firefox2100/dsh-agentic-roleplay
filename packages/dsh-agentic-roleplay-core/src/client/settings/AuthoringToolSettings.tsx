import { useEffect, useState } from 'react'
import { AUTHORING_KINDS, externalEnabled, withExternal, type ExternalTool } from '../../shared/tools.ts'
import type { Switchboard } from '../../shared/settings.ts'
import { loadExternalTools } from '../widgets/tool-switches/tools-api.ts'
import type { SettingsLocaleKey } from './locales.ts'
import css from './CatalogueSettings.module.css'

type Translate = (key: SettingsLocaleKey) => string

const boardOf = (text: string): Switchboard => {
  try {
    const parsed: unknown = JSON.parse(text === '' ? '{}' : text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Switchboard : {}
  } catch { return {} }
}

/**
 * The tools other plugins registered for everyone (a web search, MCP servers) that each authoring assistant may use. An assistant has none that is not
 * ticked here, so that a tool configured for another purpose never reaches it; the session doctor never has any.
 */
export function AuthoringToolSettings({ t, text, disabled, onEdit }: { t: Translate; text: string; disabled: boolean; onEdit: (text: string) => void }) {
  const [tools, setTools] = useState<ExternalTool[]>()
  const [failure, setFailure] = useState<string>()
  useEffect(() => {
    const abort = new AbortController()
    loadExternalTools(abort.signal).then(setTools, (error: unknown) => { if (!abort.signal.aborted) setFailure(error instanceof Error ? error.message : String(error)) })
    return () => { abort.abort() }
  }, [])
  const board = boardOf(text)
  return (
    <section className={css.section} data-testid="roleplay-authoring-tools">
      <h3 className={css.title}>{t('authoringTools')}</h3>
      <p className={css.hint}>{t('authoringToolsHint')}</p>
      {failure !== undefined && <p className={css.problem} role="alert">{failure}</p>}
      {tools !== undefined && tools.length === 0 && <p className={css.hint}>{t('authoringToolsNone')}</p>}
      {tools !== undefined && tools.length > 0 && AUTHORING_KINDS.map(kind => (
        <details key={kind} data-kind={kind}>
          <summary className={css.label}>{t(`authoringKind_${kind}`)}</summary>
          {tools.map(tool => (
            <label className={css.keyHint} key={tool.name} title={tool.description} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '4px 0' }}>
              <input type="checkbox" checked={externalEnabled(board, kind, tool.name)} disabled={disabled} data-external={tool.name} onChange={(event) => { onEdit(JSON.stringify(withExternal(board, kind, tool.name, event.target.checked))) }} />
              <span>{tool.name}</span>
            </label>
          ))}
        </details>
      ))}
    </section>
  )
}
