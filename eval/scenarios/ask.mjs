export default {
  name: 'ask',
  description: 'an out-of-character question is answered and nothing in the story changes',
  world: 'blackwater-observatory',
  player: 'arthur-moore',
  async run(story, check) {
    const events = story.one('SELECT count(*) AS n FROM events').n
    const clock = story.one('SELECT now_ms AS ms FROM clock').ms
    const read = () => story.query('SELECT character_id AS id, inner_state AS inner, public_state AS pub FROM character_state ORDER BY character_id')
    const states = JSON.stringify(read())
    await story.say('/ask Who is the woman behind the counter, and what does Arthur know about her?')
    const calls = story.chatCalls(1)
    const names = calls.map(call => call.name)
    check('the game master answered with ooc_answer', names.includes('ooc_answer'), names.join(', '))
    check('no one was asked to act and no round was resolved', !names.includes('activate_characters') && !names.includes('resolve_round'), names.join(', '))
    const delivered = (await story.timeline()).path.at(-1)?.output
    check('the player was shown an answer', delivered?.ooc?.question === true && delivered.ooc.note.length > 0, JSON.stringify(delivered?.ooc ?? null).slice(0, 200))
    check('no event was recorded', story.one('SELECT count(*) AS n FROM events').n === events)
    check('no story time passed', story.one('SELECT now_ms AS ms FROM clock').ms === clock)
    check('no character\'s state changed', JSON.stringify(read()) === states, `${states} -> ${JSON.stringify(read())}`)
    console.log(`  answer: ${delivered?.ooc?.note ?? '(none)'}`)
  },
}
