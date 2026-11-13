import type { ReactNode } from 'react'
import type { ReferencePerson } from '../../../shared/reference.ts'
import { fitLabel } from '../map-layout.ts'
import { layoutRelations, RELATION_NODE_HEIGHT, RELATION_NODE_WIDTH } from '../relations-layout.ts'
import { useReference } from '../use-reference.ts'
import type { SectionProps } from './sections.tsx'
import { Page, type Shown } from './Page.tsx'
import css from './Page.module.css'

/** The people the player's character has met around the character, each line naming what they are to each other. */
export function RelationsPage({ t, sessionId, visible }: SectionProps): ReactNode {
  const { reading } = useReference(sessionId, 'people', visible)
  const shown: Shown<ReferencePerson> = reading
  return (
    <Page<ReferencePerson> reading={shown} className={css.message ?? ''} loading={t('loading')} failed={message => t('failed', { message })} empty={t('noPeople')}>
      {(people) => {
        const layout = layoutRelations(people.map(person => person.key))
        const at = new Map(layout.nodes.map(node => [node.key, node]))
        return (
          <div className={css.map}>
            <svg width={layout.width} height={layout.height} role="img" aria-label={t('relations')}>
              <desc>{people.map(person => `${person.name}${person.label === undefined ? '' : `: ${person.label}`}`).join('; ')}</desc>
              {people.map((person) => {
                const node = at.get(person.key)
                if (node === undefined) return null
                return (
                  <g key={person.key}>
                    <line className={person.label === undefined ? css.closedWay : css.way} x1={layout.centre.x} y1={layout.centre.y} x2={node.x} y2={node.y} />
                    {person.label !== undefined && <text className={css.edgeLabel} x={(layout.centre.x + node.x) / 2} y={(layout.centre.y + node.y) / 2 - 4} textAnchor="middle">{fitLabel(person.label)}</text>}
                  </g>
                )
              })}
              <g transform={`translate(${layout.centre.x - RELATION_NODE_WIDTH / 2} ${layout.centre.y - RELATION_NODE_HEIGHT / 2})`}>
                <rect className={css.here} width={RELATION_NODE_WIDTH} height={RELATION_NODE_HEIGHT} rx={6} />
                <text className={css.placeName} x={RELATION_NODE_WIDTH / 2} y={RELATION_NODE_HEIGHT / 2} textAnchor="middle" dominantBaseline="central">{t('you')}</text>
              </g>
              {people.map((person) => {
                const node = at.get(person.key)
                if (node === undefined) return null
                return (
                  <g key={`n${person.key}`} transform={`translate(${node.x - RELATION_NODE_WIDTH / 2} ${node.y - RELATION_NODE_HEIGHT / 2})`}>
                    <title>{person.name}</title>
                    <rect className={css.place} width={RELATION_NODE_WIDTH} height={RELATION_NODE_HEIGHT} rx={6} />
                    <text className={css.placeName} x={RELATION_NODE_WIDTH / 2} y={RELATION_NODE_HEIGHT / 2} textAnchor="middle" dominantBaseline="central">{fitLabel(person.name)}</text>
                  </g>
                )
              })}
            </svg>
            <p className={css.meta}>{t('relationsHint')}</p>
          </div>
        )
      }}
    </Page>
  )
}
