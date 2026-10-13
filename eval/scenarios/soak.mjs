export default {
  name: 'soak',
  description: 'a model plays a few turns of its own choosing, and the story must stay sound',
  world: 'blackwater-observatory',
  player: 'arthur-moore',
  records: true,
  aiPlayer: { goal: 'Find out what became of the missing director of the observatory, talking to the people in town and looking where they point you.' },
  async run(story, check, ai) {
    const report = await ai.play(story)
    check('the model played to a limit or to its goal', ['done', 'turns', 'tokens', 'time'].includes(report.stop), `${report.stop}${report.error === undefined ? '' : `: ${report.error}`}`)
    check('every action it sent became a turn', (await story.turnCount()) === report.turns, `${await story.turnCount()} counted, ${report.turns} sent`)
    const path = (await story.timeline()).path
    const told = path.map(turn => JSON.stringify(turn.output?.segments ?? []))
    check('no two turns in a row were delivered the same', told.every((text, index) => index === 0 || text !== told[index - 1] || text === '[]'))
    const time = story.query('SELECT from_ms AS fromMs, to_ms AS toMs, kind FROM time_log')
    check('the story clock never ran backwards', time.every(row => row.kind === 'resync' || row.toMs >= row.fromMs), `${time.length} entries`)
    const unplaced = story.one('SELECT count(*) AS n FROM characters c WHERE NOT EXISTS (SELECT 1 FROM placements p WHERE p.kind = \'character\' AND p.entity_id = c.id)').n
    check('no character was left without a place', unplaced === 0, `${unplaced} without`)
    if (report.turns >= 2) check('the story recorded events', story.one('SELECT count(*) AS n FROM events').n > 0)
    try {
      const judged = story.chatCalls(Math.max(1, report.turns)).filter(call => call.name === 'judge_action')
      console.log(`  ${judged.filter(call => call.args?.allowed === false).length} of ${judged.length} actions were judged not to work`)
    } catch (error) { console.log(`  (chat log not read: ${error.message})`) }
  },
}
