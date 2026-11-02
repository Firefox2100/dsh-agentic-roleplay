import { useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReferencePerson, ReferencePlace, ReferenceProfile, ReferenceThing } from '../../../shared/reference.ts'
import { useReference } from '../use-reference.ts'
import type {} from '../slot-contract.ts'
import { Page, type Shown } from './Page.tsx'
import css from './Page.module.css'

export type SectionProps = PropsRuntime<'roleplay.reference.section'> & PropsLocale<'roleplay.reference'>

const unit = (count: number): string => (count === 1 ? '' : ` ×${count}`)

export function PeoplePage({ t, sessionId, visible }: SectionProps): ReactNode {
  const { reading } = useReference(sessionId, 'people', visible)
  const [open, setOpen] = useState<string>()
  return (
    <Page<ReferencePerson> reading={reading} className={css.message ?? ''} loading={t('loading')} failed={message => t('failed', { message })} empty={t('noPeople')}>
      {people => (
        <ul className={css.list}>
          {people.map(person => (
            <li key={person.key} className={css.entry}>
              <div className={css.head}>
                <button type="button" className={css.link} aria-expanded={open === person.key} onClick={() => { setOpen(open === person.key ? undefined : person.key) }}>{person.name}</button>
                {person.label !== undefined && <span className={css.sub}>{person.label}</span>}
                {person.here && <span className={css.tag}>{t('here')}</span>}
              </div>
              {person.publicState !== '' && <p className={css.text}>{person.publicState}</p>}
              {person.summary !== undefined && person.summary !== '' && <p className={css.meta}>{person.summary}</p>}
              {open === person.key && <div className={css.opened}><Observed t={t} sessionId={sessionId} character={person.key} /></div>}
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}

export function PlacesPage({ t, sessionId, visible }: SectionProps): ReactNode {
  const { reading } = useReference(sessionId, 'places', visible)
  return (
    <Page<ReferencePlace> reading={reading} className={css.message ?? ''} loading={t('loading')} failed={message => t('failed', { message })} empty={t('noPlaces')}>
      {places => (
        <ul className={css.list}>
          {places.map(place => (
            <li key={place.key} className={css.entry}>
              <div className={css.head}>
                <span className={css.name}>{place.name}</span>
                {place.parent !== undefined && <span className={css.sub}>{t('inside', { place: place.parent })}</span>}
                {place.here && <span className={css.tag}>{t('youAreHere')}</span>}
              </div>
              {place.description !== undefined && place.description !== '' && <p className={css.text}>{place.description}</p>}
              {place.features.length > 0 && <p className={css.meta}>{t('features', { list: place.features.join(', ') })}</p>}
              {place.ways.length > 0 && <p className={css.meta}>{t('ways', { list: place.ways.map(way => (way.open ? way.to : t('closedWay', { place: way.to }))).join(', ') })}</p>}
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}

export function ThingsPage({ t, sessionId, visible }: SectionProps): ReactNode {
  const { reading } = useReference(sessionId, 'things', visible)
  return (
    <Page<ReferenceThing> reading={reading} className={css.message ?? ''} loading={t('loading')} failed={message => t('failed', { message })} empty={t('noThings')}>
      {things => (
        <ul className={css.list}>
          {things.map((thing, index) => (
            <li key={`${thing.where}-${thing.name}-${index}`} className={css.entry}>
              <div className={css.head}>
                <span className={css.name}>{thing.name}{unit(thing.quantity)}</span>
                <span className={css.sub}>{t(thing.where === 'here' ? 'lyingHere' : thing.where === 'worn' ? 'worn' : 'carried')}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}

function Block({ title, children }: { title: string | undefined; children: ReactNode }): ReactNode {
  return <section className={css.block}><h3 className={css.heading}>{title}</h3>{children}</section>
}

/** A character as the audience may see them: the blocks the host left out are simply absent. */
export function ProfileCard({ profile, t, named = true }: { profile: ReferenceProfile; t: SectionProps['t']; named?: boolean }): ReactNode {
  return (
    <div>
      <div className={css.head}>
        {named && <span className={css.title}>{profile.name}</span>}
        {[profile.pronouns, profile.gender, profile.age].filter(part => part !== undefined && part !== '').map(part => <span key={part} className={css.sub}>{part}</span>)}
      </div>
      {profile.aliases.length > 0 && <p className={css.meta}>{t('aliases', { list: profile.aliases.join(', ') })}</p>}
      {profile.summary !== undefined && profile.summary !== '' && <p className={css.text}>{profile.summary}</p>}
      {(profile.publicState !== '' || (profile.activity ?? '') !== '' || (profile.innerState ?? '') !== '') && (
        <Block title={t('now')}>
          {profile.publicState !== '' && <p className={css.text}>{profile.publicState}</p>}
          {(profile.activity ?? '') !== '' && <p className={css.meta}>{t('doing')}: {profile.activity}</p>}
          {(profile.innerState ?? '') !== '' && <p className={css.meta}>{t('feeling')}: {profile.innerState}</p>}
        </Block>
      )}
      {profile.appearance !== '' && <Block title={t('appearance')}><p className={css.text}>{profile.appearance}</p></Block>}
      {(profile.personality ?? '') !== '' && <Block title={t('personality')}><p className={css.text}>{profile.personality}</p></Block>}
      {(profile.background ?? '') !== '' && <Block title={t('background')}><p className={css.text}>{profile.background}</p></Block>}
      {profile.speech !== undefined && (profile.speech.style !== '' || profile.speech.examples.length > 0) && (
        <Block title={t('speech')}>
          {profile.speech.style !== '' && <p className={css.text}>{profile.speech.style}</p>}
          {profile.speech.examples.map(example => <p key={example} className={css.meta}>“{example}”</p>)}
        </Block>
      )}
      {profile.values.length > 0 && <Block title={t('values')}><ul className={css.list}>{profile.values.map(value => <li key={value.name} className={css.text}>{value.name}: {value.value}</li>)}</ul></Block>}
      {(profile.goals ?? []).length > 0 && (
        <Block title={t('goals')}>
          <ul className={css.list}>
            {(profile.goals ?? []).map(goal => (
              <li key={goal.name} className={css.entry}>
                <span className={css.name}>{goal.name}</span>
                {goal.deadline !== undefined && <span className={css.sub}> {t('deadline', { when: goal.deadline })}</span>}
                <p className={css.text}>{goal.description}</p>
                {goal.plan.length > 0 && <p className={css.meta}>{goal.plan.join(' → ')}</p>}
              </li>
            ))}
          </ul>
        </Block>
      )}
      {(profile.groups ?? []).length > 0 && <Block title={t('groups')}><ul className={css.list}>{(profile.groups ?? []).map(group => <li key={group.name} className={css.text}>{group.name} <span className={css.sub}>{group.role}</span></li>)}</ul></Block>}
      {profile.beliefs !== undefined && profile.totals !== undefined && profile.beliefs.length > 0 && (
        <Block title={t('beliefs', { count: profile.totals.beliefs })}>
          <ul className={css.list}>
            {profile.beliefs.map((belief, index) => (
              <li key={index} className={css.entry}>
                <p className={css.text}>{belief.text}</p>
                <p className={css.meta}>{t(belief.confidence)} · {t('turn', { turn: belief.turn })}</p>
              </li>
            ))}
          </ul>
          {profile.totals.beliefs > profile.beliefs.length && <p className={css.meta}>{t('showing', { shown: profile.beliefs.length, count: profile.totals.beliefs })}</p>}
        </Block>
      )}
      {profile.recollections !== undefined && profile.totals !== undefined && profile.recollections.length > 0 && (
        <Block title={t('recollections', { count: profile.totals.recollections })}>
          <ul className={css.list}>
            {profile.recollections.map((recollection, index) => (
              <li key={index} className={css.entry}>
                <p className={css.text}>{recollection.text}</p>
                <p className={css.meta}>{t(recollection.mode)} · {t('turn', { turn: recollection.turn })}</p>
              </li>
            ))}
          </ul>
          {profile.totals.recollections > profile.recollections.length && <p className={css.meta}>{t('showing', { shown: profile.recollections.length, count: profile.totals.recollections })}</p>}
        </Block>
      )}
    </div>
  )
}

/** The player's own page: what they are, feel and want, and everything they remember. */
export function ProfilePage({ t, sessionId, visible }: SectionProps): ReactNode {
  const { reading } = useReference(sessionId, 'profile', visible)
  const shown: Shown<ReferenceProfile> = reading
  return (
    <Page<ReferenceProfile> reading={shown} className={css.message ?? ''} loading={t('loading')} failed={message => t('failed', { message })} empty={t('noProfile')}>
      {([profile]) => profile === undefined ? null : <ProfileCard profile={profile} t={t} />}
    </Page>
  )
}

/** Another character, as an observer sees them; read only while it is open. */
function Observed({ t, sessionId, character }: { t: SectionProps['t']; sessionId: string; character: string }): ReactNode {
  const { reading } = useReference(sessionId, 'profile', true, character)
  const shown: Shown<ReferenceProfile> = reading
  return (
    <Page<ReferenceProfile> reading={shown} className={css.message ?? ''} loading={t('loading')} failed={message => t('failed', { message })} empty={t('noProfile')}>
      {([profile]) => profile === undefined ? null : <ProfileCard profile={profile} t={t} named={false} />}
    </Page>
  )
}
