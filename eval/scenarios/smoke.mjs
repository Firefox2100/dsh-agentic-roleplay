export default {
  name: 'smoke',
  description: 'two ordinary turns: look around, then talk to someone',
  world: 'blackwater-observatory',
  player: 'arthur-moore',
  records: true,
  async run(story, check) {
    await story.say('I look around the bar and take in who is here.')
    await story.say('I walk up to the woman behind the counter, greet her and ask whether she has heard anything about the missing director.')
    check('both turns were counted', (await story.turnCount()) === 2, await story.turnCount())
    check('events were recorded', story.one('SELECT count(*) AS n FROM events').n > 0, `${story.one('SELECT count(*) AS n FROM events').n} events`)
    check('someone other than the player perceived something', story.one("SELECT count(*) AS n FROM perceptions p JOIN characters c ON c.id = p.character_id WHERE c.control = 'agent'").n > 0)
    const activity = await story.activity()
    check('a character was asked', activity.some(run => run.label !== 'record keeper' && run.error === undefined && run.calls > 0), activity.map(run => run.label).join(', '))
  },
}
