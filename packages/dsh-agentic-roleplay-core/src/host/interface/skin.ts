export interface SkinProblem {
  line: number
  message: string
}

export interface CheckedSkin {
  css: string
  problems: SkinProblem[]
}

/** Maps a path written in the skin (relative to the pack) to the address it is served at, or nothing when the pack has no such file. */
export type SkinUrl = (path: string) => string | undefined

const NESTABLE = new Set(['media', 'supports'])
const FORBIDDEN_TEXT = ['expression(', 'behavior', '-moz-binding', 'javascript:', 'image-set(', 'src(', 'cross-fade(', 'element(', 'paint(']
const MAX_DEPTH = 3

/** Comments are blanked, newlines kept, so that lines still count. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
}

const lineAt = (text: string, offset: number): number => text.slice(0, offset).split('\n').length

/** The text up to the next `{` or `;` outside strings and brackets, with which of them ended it. */
function scanPrelude(text: string, from: number): { end: number; stop: '{' | ';' | '}' | undefined } {
  let quote = ''
  let depth = 0
  for (let index = from; index < text.length; index += 1) {
    const char = text[index] as string
    if (quote !== '') {
      if (char === '\\') index += 1
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1)
    else if (depth === 0 && (char === '{' || char === ';' || char === '}')) return { end: index, stop: char }
  }
  return { end: text.length, stop: undefined }
}

/** The index of the `}` that closes the block opened just before `from`. */
function closing(text: string, from: number): number {
  let quote = ''
  let depth = 1
  for (let index = from; index < text.length; index += 1) {
    const char = text[index] as string
    if (quote !== '') {
      if (char === '\\') index += 1
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '{') depth += 1
    else if (char === '}') { depth -= 1; if (depth === 0) return index }
  }
  return -1
}

/** Every compound selector of a selector must name an element of ours through `[data-rp...]` standing on its own, not inside a function. */
function selectorProblem(selector: string): string | undefined {
  const text = selector.trim()
  if (text === '') return 'an empty selector'
  const compounds: string[] = []
  let current = ''
  let depth = 0
  let bracket = 0
  let quote = ''
  for (const char of text) {
    if (quote !== '') { current += char; if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'") { quote = char; current += char; continue }
    if (char === '[') bracket += 1
    if (char === ']') bracket = Math.max(0, bracket - 1)
    if (char === '(') depth += 1
    if (char === ')') depth = Math.max(0, depth - 1)
    if (depth === 0 && bracket === 0 && /[\s>+~]/.test(char)) { if (current !== '') compounds.push(current); current = ''; continue }
    current += char
  }
  if (current !== '') compounds.push(current)
  for (const compound of compounds) {
    if (compound.includes('&')) return `"${selector.trim()}": nesting is not supported`
    if (!standsOn(compound)) return `"${selector.trim()}": every part of a selector must name one of our elements with [data-rp="..."]`
  }
  return undefined
}

/** Whether `[data-rp` occurs outside parentheses of the compound selector. */
function standsOn(compound: string): boolean {
  let depth = 0
  let quote = ''
  for (let index = 0; index < compound.length; index += 1) {
    const char = compound[index] as string
    if (quote !== '') { if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'") quote = char
    else if (char === '(') depth += 1
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && char === '[' && /^\[\s*data-rp(?![\w-])/i.test(compound.slice(index))) return true
  }
  return false
}

/** Whether a backslash stands outside the strings of a text: escapes there could spell what is refused. */
function hasBareEscape(text: string): boolean {
  let quote = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string
    if (quote !== '') { if (char === '\\') index += 1; else if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'") quote = char
    else if (char === '\\') return true
  }
  return false
}

function declarationProblem(body: string, url: SkinUrl): { css: string; problem?: string } {
  if (body.includes('{')) return { css: body, problem: 'rules inside a rule (nesting) are not supported' }
  if (hasBareEscape(body)) return { css: body, problem: 'escapes outside strings are not allowed' }
  const lower = body.toLowerCase()
  const forbidden = FORBIDDEN_TEXT.find(text => lower.includes(text))
  if (forbidden !== undefined) return { css: body, problem: `"${forbidden}" is not allowed` }
  if (lower.includes('@import')) return { css: body, problem: '@import is not allowed' }
  let problem: string | undefined
  const css = body.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi, (match, double: string | undefined, single: string | undefined, bare: string | undefined) => {
    const path = (double ?? single ?? bare ?? '').trim()
    if (path === '' || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('/') || path.startsWith('#')) { problem ??= `url(${path}) must be a path inside the pack`; return match }
    const address = url(path)
    if (address === undefined) { problem ??= `url(${path}): the pack has no such file`; return match }
    return `url("${address}")`
  })
  return problem === undefined ? { css } : { css, problem }
}

interface Context {
  text: string
  url: SkinUrl
  problems: SkinProblem[]
}

function block(context: Context, from: number, to: number, depth: number, topLevel: boolean): string {
  const { text } = context
  let out = ''
  let index = from
  while (index < to) {
    while (index < to && /\s/.test(text[index] as string)) index += 1
    if (index >= to) break
    const prelude = scanPrelude(text, index)
    const header = text.slice(index, Math.min(prelude.end, to)).trim()
    const line = lineAt(text, index)
    if (prelude.stop !== '{') {
      context.problems.push({ line, message: header.startsWith('@') ? `${header.split(/\s/)[0]} is not allowed` : `"${header.slice(0, 40)}" is not a rule` })
      index = prelude.end + 1
      continue
    }
    const end = closing(text, prelude.end + 1)
    if (end === -1) { context.problems.push({ line, message: 'a rule is not closed' }); break }
    const inner = text.slice(prelude.end + 1, end)
    if (header.startsWith('@')) out += atRule(context, header, inner, prelude.end + 1, end, line, depth, topLevel)
    else out += styleRule(context, header, inner, line)
    index = end + 1
  }
  return out
}

function styleRule(context: Context, header: string, body: string, line: number): string {
  const selectors = splitSelectors(header)
  for (const selector of selectors) {
    const problem = selectorProblem(selector)
    if (problem !== undefined) context.problems.push({ line, message: problem })
  }
  const checked = declarationProblem(body, context.url)
  if (checked.problem !== undefined) context.problems.push({ line, message: checked.problem })
  return `${header} {${checked.css}}\n`
}

function atRule(context: Context, header: string, inner: string, start: number, end: number, line: number, depth: number, topLevel: boolean): string {
  const name = /^@([a-z-]+)/i.exec(header)?.[1]?.toLowerCase() ?? ''
  if (NESTABLE.has(name)) {
    if (depth >= MAX_DEPTH) { context.problems.push({ line, message: `@${name} is nested too deep` }); return '' }
    return `${header} {\n${block(context, start, end, depth + 1, false)}}\n`
  }
  if (name === 'keyframes') {
    const frames = inner.replace(/\{([^{}]*)\}/g, (_match, body: string) => {
      const checked = declarationProblem(body, context.url)
      if (checked.problem !== undefined) context.problems.push({ line, message: `@keyframes: ${checked.problem}` })
      return `{${checked.css}}`
    })
    return `${header} {${frames}}\n`
  }
  if (name === 'font-face') {
    if (!topLevel) context.problems.push({ line, message: '@font-face must stand at the top' })
    const checked = declarationProblem(inner, context.url)
    if (checked.problem !== undefined) context.problems.push({ line, message: `@font-face: ${checked.problem}` })
    return `${header} {${checked.css}}\n`
  }
  context.problems.push({ line, message: `@${name} is not allowed (allowed: @media, @supports, @keyframes, @font-face)` })
  return ''
}

/** Splits a selector list at the commas that are not inside brackets, parentheses or strings. */
function splitSelectors(header: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  let quote = ''
  for (const char of header) {
    if (quote !== '') { current += char; if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'") quote = char
    if (char === '(' || char === '[') depth += 1
    if (char === ')' || char === ']') depth = Math.max(0, depth - 1)
    if (char === ',' && depth === 0) { parts.push(current); current = ''; continue }
    current += char
  }
  parts.push(current)
  return parts
}

/**
 * Checks a skin and puts it in the form that goes into the page: rules for our own elements only
 * (`[data-rp]`), no imports, no scripts or escapes in disguise, and urls only to files of the pack.
 * The returned css is empty when there are problems.
 */
export function checkSkin(css: string, url: SkinUrl): CheckedSkin {
  const text = withoutComments(css.replace(/^﻿/, ''))
  const context: Context = { text, url, problems: [] }
  const out = block(context, 0, text.length, 0, true)
  return context.problems.length === 0 ? { css: out, problems: [] } : { css: '', problems: context.problems }
}
