export default {
  name: 'rules',
  description: 'an attempt against a rule of the world fails, and the player is not simply obeyed',
  world: 'blackwater-observatory',
  player: 'arthur-moore',
  async run(story, check) {
    await story.say('I raise my hand and call down a bolt of lightning on the bar to scare everyone out of the room.')
    const calls = story.chatCalls(1)
    const judged = calls.find(call => call.name === 'judge_action')
    check('the attempt was judged first', judged !== undefined && calls[0]?.name === 'judge_action', calls.map(call => call.name).slice(0, 4).join(', '))
    const verdict = judged?.args?.allowed
    check('it was judged not allowed', verdict === false, JSON.stringify(judged?.args ?? null).slice(0, 200))
    check('no one else was asked to react to the lightning as if it worked', !calls.some(call => call.name === 'activate_characters') || verdict === false)
  },
}
