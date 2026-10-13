export default {
  name: 'time',
  description: 'waiting for a while moves the story clock forward',
  world: 'blackwater-observatory',
  player: 'arthur-moore',
  async run(story, check) {
    const before = story.one('SELECT now_ms AS ms FROM clock').ms
    await story.say('I take a seat at the end of the bar, order a drink and spend two hours just watching the room and the people in it.')
    const after = story.one('SELECT now_ms AS ms FROM clock').ms
    const hours = (after - before) / 3_600_000
    check('about two hours passed in the story', hours >= 1 && hours <= 6, `${hours.toFixed(2)} hours`)
  },
}
