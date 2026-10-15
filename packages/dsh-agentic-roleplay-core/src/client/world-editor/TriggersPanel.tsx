import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorldState, WorldTrigger } from '../../shared/world-state.ts'
import type { TriggersLocaleKey } from './triggers-locales.ts'
import { describeCondition, describeEffect, namesOf } from './trigger-text.ts'
import type { Translate } from './WorldEditor.tsx'
import css from './CharactersPanel.module.css'

const STATUS = { fired: 'fired', failed: 'failed', expired: 'expired', dormant: 'dormant' } as const

/** What the world does by itself, in sentences: what each trigger waits for and does, and what is wrong with it. It is read-only; the files and the world author make them. */
export function TriggersPanel({ t, world, actions }: { t: Translate; world: WorldState; actions: React.ReactNode }) {
  const say = (key: TriggersLocaleKey, values?: Record<string, string | number>): string => t(`trig_${key}`, values)
  const names = namesOf(world)
  const story = world.triggers?.some(trigger => trigger.status !== undefined) === true
  const triggers = world.triggers ?? []
  const meta = (trigger: WorldTrigger): string[] => [
    ...(trigger.repeat ? [say('repeats')] : []),
    ...(trigger.cooldownSeconds === undefined ? [] : [say('cooldown', { time: `${Math.round(trigger.cooldownSeconds / 60)} min` })]),
    ...(trigger.chance === undefined ? [] : [say('chance', { percent: Math.round(trigger.chance * 100) })]),
    ...(trigger.priority === 0 ? [] : [say('priority', { value: trigger.priority })]),
    ...(trigger.expires === undefined ? [] : [say('expires', { at: trigger.expires.replace('T', ' ') })]),
    ...(trigger.announced ? [say('announced')] : []),
  ]
  return (
    <div className={css.panel}>
      <div className={css.tabs}><span className={css.tabsSpace} />{actions}</div>
      <div className={css.body}>
        <article className={css.sheet}>
          <p>{story ? t('trig_helpStory') : t('trig_help')}</p>
          {world.triggersProblem !== undefined && <p className={css.error} role="alert">{t('trig_fileProblem', { message: world.triggersProblem })}</p>}
          {world.triggersProblem === undefined && triggers.length === 0 && <p>{t('trig_none')}</p>}
          {triggers.map(trigger => (
            <section key={trigger.key} className={css.section} data-testid={`roleplay-trigger-${trigger.key}`}>
              <h3 className={css.sectionTitle}>{trigger.name} <Tag>{trigger.key}</Tag>{trigger.status !== undefined && <> <Tag>{say(STATUS[trigger.status])}</Tag>{trigger.fireCount !== undefined && trigger.fireCount > 0 && <span> {say('firedCount', { count: trigger.fireCount })}</span>}</>}{trigger.origin === 'story' && <> <Tag>{say('fromStory')}</Tag></>}</h3>
              <p><span className={css.label}>{say('when')}</span> {describeCondition(say, names, trigger.when)}</p>
              <div><span className={css.label}>{say('then')}</span><ul>{trigger.effects.map((effect, index) => <li key={index}>{describeEffect(say, names, effect)}</li>)}</ul></div>
              {meta(trigger).length > 0 && <p>{meta(trigger).join(' · ')}</p>}
              {trigger.problems.length > 0 && <div className={css.error} role="alert"><strong>{say('problems')}</strong><ul>{trigger.problems.map(problem => <li key={problem}>{problem}</li>)}</ul></div>}
            </section>
          ))}
        </article>
      </div>
    </div>
  )
}
