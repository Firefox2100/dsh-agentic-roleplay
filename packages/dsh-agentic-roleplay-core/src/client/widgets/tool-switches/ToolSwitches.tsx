import { externalEnabled, switchesOf, withExternal, withSwitch, type AgentKind, type ExternalTool } from '../../../shared/tools.ts'
import type { Switchboard } from '../../../shared/settings.ts'
import type { ToolSwitchKey } from './locales.ts'
import css from './ToolSwitches.module.css'

/**
 * The optional tools of each kind of agent, each a switch. It shows only the tools this version offers: names in the board it does not know
 * stay in it untouched, so that what a world or a settings file carries from another version survives a change made here.
 */
export function ToolSwitches({ board, onChange, disabled, error, external = [], t }: { board: Switchboard; onChange: (next: Switchboard) => void; disabled?: boolean; error?: string; /** The tools other plugins registered, which can be given to an agent: none are on unless switched on. */ external?: readonly ExternalTool[]; t: (key: ToolSwitchKey, values?: Record<string, string>) => string }) {
  return (
    <section className={css.root} data-testid="roleplay-tool-switches" data-rp="tool-switches">
      <h3 className={css.title}>{t('sw_title')}</h3>
      <p className={css.help}>{t('sw_help')}</p>
      {error !== undefined && <span className={css.error} role="alert">{t('sw_failed', { message: error })}</span>}
      {switchesOf(board).map(entry => (
        <div className={css.agent} key={entry.agent} data-agent={entry.agent}>
          <span className={css.agentName}>{t(`sw_agent_${entry.agent}` as ToolSwitchKey)}</span>
          <span className={css.hint}>{t(`sw_agent_${entry.agent}_hint` as ToolSwitchKey)}</span>
          {entry.tools.length === 0 && <span className={css.hint}>{t('sw_none')}</span>}
          {entry.tools.map(tool => (
            <label className={css.tool} key={tool.id}>
              <input type="checkbox" aria-label={t(`sw_tool_${tool.id}` as ToolSwitchKey)} checked={tool.enabled} disabled={disabled} data-tool={tool.id} onChange={(event) => { onChange(withSwitch(board, entry.agent as AgentKind, tool.id, event.target.checked)) }} />
              <span className={css.toolText}>
                <span>{t(`sw_tool_${tool.id}` as ToolSwitchKey)}{tool.default ? <span className={css.default}>{t('sw_default')}</span> : null}</span>
                <span className={css.hint}>{t(`sw_tool_${tool.id}_hint` as ToolSwitchKey)}</span>
              </span>
            </label>
          ))}
          {external.length > 0 && (
            <details className={css.external} data-testid="roleplay-external-tools">
              <summary className={css.hint}>{t('sw_external', { count: String(external.length), on: String(external.filter(tool => externalEnabled(board, entry.agent as AgentKind, tool.name)).length) })}</summary>
              <span className={css.hint}>{t('sw_external_help')}</span>
              {external.map(tool => (
                <label className={css.tool} key={tool.name} title={tool.description}>
                  <input type="checkbox" aria-label={tool.name} checked={externalEnabled(board, entry.agent as AgentKind, tool.name)} disabled={disabled} data-external={tool.name} onChange={(event) => { onChange(withExternal(board, entry.agent as AgentKind, tool.name, event.target.checked)) }} />
                  <span className={css.toolText}>
                    <span>{tool.name}</span>
                    <span className={css.hint}>{tool.description.length > 140 ? `${tool.description.slice(0, 140)}…` : tool.description}</span>
                  </span>
                </label>
              ))}
            </details>
          )}
        </div>
      ))}
      {external.length === 0 && <p className={css.hint}>{t('sw_external_none')}</p>}
    </section>
  )
}
