const text = (id, value) => { document.getElementById(id).textContent = value }

rp.watch((view) => {
  text('place', view.place ? view.place.name : 'Nowhere in particular')
  text('time', view.time ? view.time.text : '')
  const here = view.place ? view.place.here.map(person => person.name) : []
  const tracked = view.variables.filter(entry => entry.subject !== 'the world').map(entry => `${entry.subject}: ${entry.name} ${entry.value}`)
  text('more', [here.length > 0 ? `with ${here.join(', ')}` : 'alone', ...tracked].join(' · '))
  rp.resize(document.documentElement.scrollHeight)
})
