export default {
  name: 'memory',
  description: 'what is said in front of a character is written down for that character',
  world: 'blackwater-observatory',
  player: 'arthur-moore',
  records: true,
  async run(story, check) {
    await story.say('I lean across the counter and tell the woman behind it quietly: "My name is Arthur Moore. I have a letter that brought me here, and I mean to ask about Harlan Voss before the festival ends."')
    const events = story.query('SELECT text FROM events ORDER BY id')
    check('the first turn was written down as events', events.length > 0, `${events.length} events`)
    check('the events say what was told', events.some(event => /letter|harlan|arthur/i.test(event.text)), events.map(event => event.text.slice(0, 60)).join(' | '))
    const heard = story.query("SELECT c.name AS name FROM perceptions p JOIN characters c ON c.id = p.character_id WHERE c.control = 'agent' GROUP BY c.id")
    check('a character who was there perceived it', heard.length > 0, heard.map(row => row.name).join(', '))
    await story.say('I ask her what she remembers of what I just told her.')
    const activity = await story.activity()
    check('she answered from the record without a helper failing', !activity.some(run => run.error !== undefined && run.label !== 'record keeper'), activity.filter(run => run.error !== undefined).map(run => run.label).join(', '))
  },
}
