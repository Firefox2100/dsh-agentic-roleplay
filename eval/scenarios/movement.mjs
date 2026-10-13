export default {
  name: 'movement',
  description: 'the player walks through an exit and is placed where it leads',
  world: 'blackwater-observatory',
  player: 'arthur-moore',
  async run(story, check) {
    const player = story.one("SELECT id FROM characters WHERE control = 'player'").id
    const from = story.one("SELECT location_id AS id FROM placements WHERE kind = 'character' AND entity_id = ?", player).id
    const exits = story.query('SELECT e.to_id AS id, l.name AS name, e.description AS how FROM exits e JOIN locations l ON l.id = e.to_id WHERE e.from_id = ? AND e.state = ?', from, 'open')
    check('the player starts somewhere with a way out', exits.length > 0, `${exits.length} exits`)
    const target = exits[0]
    await story.say(`I leave through ${target.how} and go to ${target.name}.`)
    const now = story.one("SELECT location_id AS id FROM placements WHERE kind = 'character' AND entity_id = ?", player).id
    check(`the player is at ${target.name}`, now === target.id, `at location ${now}, expected ${target.id}`)
    check('time passed on the way', story.one("SELECT count(*) AS n FROM time_log WHERE kind IN ('elapsed', 'skip')").n > 0)
  },
}
