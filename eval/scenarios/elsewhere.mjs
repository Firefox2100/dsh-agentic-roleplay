export default {
  name: 'elsewhere',
  description: 'an action said to happen at another place does not work from here, and the player stays where they are',
  world: 'blackwater-observatory',
  player: 'arthur-moore',
  async run(story, check) {
    const player = story.one("SELECT id FROM characters WHERE control = 'player'").id
    const here = () => story.one("SELECT location_id AS id FROM placements WHERE kind = 'character' AND entity_id = ?", player).id
    const before = here()
    await story.say('Without leaving my seat, I search the records room of the town hall for the ledger that shows who paid for the observatory.')
    const calls = story.chatCalls(1)
    const judged = calls.find(call => call.name === 'judge_action')
    console.log(`  place named by the game master: ${judged?.args?.at ?? '(none: it judged by what is out of reach)'}`)
    check('it was judged not to work', judged?.args?.allowed === false || /has to go there first/.test(JSON.stringify(judged?.result ?? '')), JSON.stringify(judged?.result ?? null).slice(0, 240))
    check('the player stayed where they were', here() === before)
  },
}
