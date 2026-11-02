import type { ReactNode } from 'react'
import type { ReferencePlace } from '../../../shared/reference.ts'
import { fitLabel, layoutMap, NODE_HEIGHT, NODE_WIDTH } from '../map-layout.ts'
import { useReference } from '../use-reference.ts'
import type { SectionProps } from './sections.tsx'
import { Page, type Shown } from './Page.tsx'
import css from './Page.module.css'

/** The places the player's character knows, set out from where they are by how many ways away each is. */
export function MapPage({ t, sessionId, visible }: SectionProps): ReactNode {
  const { reading } = useReference(sessionId, 'places', visible)
  const shown: Shown<ReferencePlace> = reading
  return (
    <Page<ReferencePlace> reading={shown} className={css.message ?? ''} loading={t('loading')} failed={message => t('failed', { message })} empty={t('noPlaces')}>
      {(places) => {
        const layout = layoutMap(places, places.flatMap(place => place.ways.map(way => ({ from: place.key, to: way.toKey, open: way.open }))))
        const byKey = new Map(places.map(place => [place.key, place]))
        const at = new Map(layout.nodes.map(node => [node.key, node]))
        return (
          <div className={css.map}>
            <svg width={layout.width} height={layout.height} role="img" aria-label={t('map')}>
              {layout.links.map((link) => {
                const from = at.get(link.from)
                const to = at.get(link.to)
                if (from === undefined || to === undefined) return null
                const forward = from.x <= to.x
                const x1 = from.x + (forward ? NODE_WIDTH : 0)
                const x2 = to.x + (forward ? 0 : NODE_WIDTH)
                return <line key={`${link.from}-${link.to}`} className={link.open ? css.way : css.closedWay} x1={from.x === to.x ? from.x + NODE_WIDTH / 2 : x1} y1={from.y + NODE_HEIGHT / 2} x2={from.x === to.x ? to.x + NODE_WIDTH / 2 : x2} y2={to.y + NODE_HEIGHT / 2} />
              })}
              {layout.nodes.map((node) => {
                const place = byKey.get(node.key)
                if (place === undefined) return null
                return (
                  <g key={node.key} transform={`translate(${node.x} ${node.y})`}>
                    <title>{place.name}</title>
                    <rect className={place.here ? css.here : css.place} width={NODE_WIDTH} height={NODE_HEIGHT} rx={6} />
                    <text className={css.placeName} x={NODE_WIDTH / 2} y={NODE_HEIGHT / 2} textAnchor="middle" dominantBaseline="central">{fitLabel(place.name)}</text>
                  </g>
                )
              })}
            </svg>
            <p className={css.meta}>{t('mapHint')}</p>
          </div>
        )
      }}
    </Page>
  )
}
