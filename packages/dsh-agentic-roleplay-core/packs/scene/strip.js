const WORDS = {
  en: { nowhere: 'Nowhere in particular', alone: 'alone', with: 'with', map: 'Map', mapTitle: 'Show the map in the sidebar' },
  zh: { nowhere: '不在任何特定地点', alone: '独自一人', with: '与', map: '地图', mapTitle: '在侧栏显示地图' },
}
const words = () => WORDS[document.documentElement.lang] ?? WORDS.en
const text = (id, value) => { document.getElementById(id).textContent = value }
let latest

function render() {
  const view = latest
  if (view === undefined) return
  const w = words()
  text('place', view.place ? view.place.name : w.nowhere)
  text('time', view.time ? [view.time.text, ...view.time.holidays].join(' · ') : '')
  const here = view.place ? view.place.here.map(person => person.name) : []
  const tracked = view.variables.filter(entry => entry.subject !== 'the world').map(entry => `${entry.subject}: ${entry.name} ${entry.value}`)
  text('more', [here.length > 0 ? `${w.with} ${here.join(', ')}` : w.alone, ...tracked].join(' · '))
  const button = document.getElementById('map')
  button.textContent = w.map
  button.title = w.mapTitle
  rp.resize(document.documentElement.scrollHeight)
}

rp.watch((view) => { latest = view; render() })
rp.on('theme', render)
document.getElementById('map').addEventListener('click', () => { rp.open('sidebar').catch(error => console.warn(error)) })
