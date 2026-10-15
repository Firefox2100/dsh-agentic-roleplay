const SVG = 'http://www.w3.org/2000/svg'
const CENTRE = 200
const RADIUS = 140

function element(name, attributes = {}, text) {
  const node = document.createElementNS(SVG, name)
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value))
  if (text !== undefined) node.textContent = text
  return node
}

/** Where each known place is drawn: the one the player is in at the centre, the others around it. */
function layout(places) {
  const others = places.filter(place => !place.here)
  const spots = new Map(places.filter(place => place.here).map(place => [place.key, { x: CENTRE, y: CENTRE }]))
  others.forEach((place, index) => {
    const angle = (index / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2
    spots.set(place.key, { x: CENTRE + RADIUS * Math.cos(angle), y: CENTRE + RADIUS * Math.sin(angle) })
  })
  return spots
}

rp.watch((view) => {
  const svg = document.getElementById('map')
  document.getElementById('empty').hidden = view.map.places.length > 0
  const spots = layout(view.map.places)
  svg.replaceChildren(
    ...view.map.routes.flatMap((route) => {
      const from = spots.get(route.from)
      const to = spots.get(route.to)
      return from && to ? [element('line', { class: 'edge', x1: from.x, y1: from.y, x2: to.x, y2: to.y })] : []
    }),
    ...view.map.places.map((place) => {
      const spot = spots.get(place.key)
      const group = element('g', { class: place.here ? 'node here' : 'node', transform: `translate(${spot.x} ${spot.y})` })
      group.append(element('circle', { r: place.here ? 11 : 8 }), element('text', { y: place.here ? 28 : 24 }, place.name))
      return group
    }),
  )
})
