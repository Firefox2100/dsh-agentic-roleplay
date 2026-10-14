const $ = id => document.getElementById(id)

function fill(list, items, empty) {
  list.replaceChildren(...(items.length > 0 ? items : [empty]).map((item) => {
    const entry = document.createElement('li')
    if (typeof item === 'string') { entry.textContent = item; entry.className = 'muted' } else { entry.textContent = item.text; if (item.here) entry.className = 'here' }
    return entry
  }))
}

rp.watch((view) => {
  const place = view.place
  $('here').textContent = place ? `${place.name}. ${place.description}` : 'You are not anywhere the story has placed you.'
  fill($('exits'), place ? place.exits.map(exit => ({ text: `${exit.open ? 'Way to' : 'Blocked way to'} ${exit.name}` })) : [], 'No way out that you know of.')
  fill($('people'), place ? place.here.map(person => ({ text: person.publicState === '' ? person.name : `${person.name} — ${person.publicState}` })) : [], 'No one else.')
  fill($('places'), view.map.places.map(entry => ({ text: entry.here ? `${entry.name} (you are here)` : entry.name, here: entry.here })), 'None yet.')
  fill($('carried'), view.carried.map(item => ({ text: `${item.quantity > 1 ? `${item.quantity} × ` : ''}${item.name} — ${item.where}` })), 'Nothing.')
  $('ideas-box').hidden = view.suggestions.length === 0
  $('ideas').replaceChildren(...view.suggestions.map((idea, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = idea
    button.addEventListener('click', () => { rp.choose(index).catch(error => console.warn(error)) })
    return button
  }))
})

function brief(turn) {
  const told = turn.segments.find(segment => segment.type === 'narration') ?? turn.segments[0]
  const text = told ? told.text : turn.note ?? ''
  return { text: `${turn.turn}. ${turn.player} — ${text.length > 140 ? `${text.slice(0, 140)}…` : text}` }
}

function showStory() {
  rp.history(6).then((turns) => { fill($('story'), turns.reverse().map(brief), 'Nothing has happened yet.') }, error => console.warn(error))
}
showStory()
rp.on('turn', showStory)

let saving
rp.storage.get('notes').then((saved) => { if (typeof saved === 'string') $('notes').value = saved })
$('notes').addEventListener('input', () => {
  clearTimeout(saving)
  saving = setTimeout(() => { rp.storage.set('notes', $('notes').value).catch(error => console.warn(error)) }, 600)
})
