import { describe, expect, it } from 'vitest'
import { checkSkin } from '../../../src/host/interface/skin.ts'

const files = new Set(['font.woff2', 'img/paper.png'])
const url = (path: string): string | undefined => (files.has(path) ? `/file/${path}` : undefined)
const messages = (css: string): string[] => checkSkin(css, url).problems.map(problem => problem.message)

describe('a skin', () => {
  it('may restyle the elements that carry data-rp', () => {
    const result = checkSkin(`
      /* the lines people say */
      [data-rp="utterance"] { border-left: 3px solid red; }
      [data-rp="utterance"] [data-rp="words"], [data-rp~="prose"]:hover { font-style: italic; }
      @media (max-width: 600px) { [data-rp="avatar"] { display: none; } }
      @font-face { font-family: Old; src: url("font.woff2"); }
      @keyframes glow { from { opacity: 0.5 } to { opacity: 1 } }
    `, url)
    expect(result.problems).toEqual([])
    expect(result.css).toContain('[data-rp="utterance"]')
    expect(result.css).toContain('url("/file/font.woff2")')
  })

  it('points a url at the pack file route, and refuses a file the pack does not have', () => {
    expect(checkSkin('[data-rp="narration"] { background: url(img/paper.png) }', url).css).toContain('url("/file/img/paper.png")')
    expect(messages('[data-rp="narration"] { background: url(img/none.png) }')).toEqual(['url(img/none.png): the pack has no such file'])
  })

  it('refuses selectors that reach beyond our elements', () => {
    for (const selector of ['body', ':root', '.chat', 'div', '[data-rp="a"] div', '[data-rp="a"] > .x', 'div:not([data-rp])', '*', '[data-other] ']) {
      expect(messages(`${selector} { color: red }`), selector).not.toEqual([])
    }
  })

  it('refuses at-rules that load or reconfigure things', () => {
    expect(messages('@import url("x.css");')).toEqual(['@import is not allowed'])
    expect(messages('@charset "utf-8";')).toEqual(['@charset is not allowed'])
    expect(messages('@container (min-width: 1px) { [data-rp="a"] { color: red } }')).toEqual(['@container is not allowed (allowed: @media, @supports, @keyframes, @font-face)'])
  })

  it('refuses addresses outside the pack and code in disguise', () => {
    for (const declaration of ['background: url(https://evil.example/x.png)', 'background: url("//evil.example/x.png")', 'background: url(/etc/passwd)', 'background: url(data:image/svg+xml,x)', 'background: image-set("a.png" 1x)', 'width: expression(alert(1))', 'behavior: url(x.htc)', 'background: \\75rl(x)', 'color: red; nested { color: blue }']) {
      expect(messages(`[data-rp="a"] { ${declaration} }`), declaration).not.toEqual([])
    }
  })

  it('allows escapes inside strings', () => {
    expect(messages('[data-rp="a"]::before { content: "\\201C" }')).toEqual([])
  })

  it('says where a problem is and returns nothing when there is one', () => {
    const result = checkSkin('[data-rp="a"] { color: red }\n\nbody { color: blue }\n', url)
    expect(result.problems).toEqual([{ line: 3, message: '"body": every part of a selector must name one of our elements with [data-rp="..."]' }])
    expect(result.css).toBe('')
  })
})
