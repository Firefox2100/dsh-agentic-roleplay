export default {
  name: 'inspector',
  description: 'with diagnostics on, each helper run can be opened to see what it was told and did',
  world: 'blackwater-observatory',
  player: 'arthur-moore',
  settings: { diagnostics: { keepRuns: true } },
  async run(story, check) {
    await story.say('I nod to the woman behind the counter and ask her what is good tonight.')
    const kept = (await story.activity()).filter(run => run.run !== undefined)
    check('the helper runs name their stored detail', kept.length > 0, `${kept.length} runs`)
    const details = await Promise.all(kept.map(run => story.dsh.api(`/sessions/activity/run?id=${story.id}&run=${run.run}`)))
    check('each can be read back', details.length > 0 && details.every(detail => detail !== undefined))
    check('each has its instructions and what it was asked', details.every(detail => detail.persona.length > 0 && detail.prompt.length > 0))
    check('the calls and the result are there', details.some(detail => detail.calls.length > 0) && details.some(detail => detail.result !== undefined))
  },
}
