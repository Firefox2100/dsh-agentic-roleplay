import { spawn } from 'node:child_process'
import { RcloneError } from './errors.ts'

export interface RcloneResult {
  code: number
  stdout: string
  stderr: string
}

/** One rclone command; the seam the engine is tested through. */
export interface Rclone {
  run(args: readonly string[], options?: { input?: string; signal?: AbortSignal }): Promise<RcloneResult>
}

export interface RcloneSetup {
  /** The executable; empty means `rclone` from the PATH. */
  binary: string
  configFile: string
  /** The password of an encrypted configuration file; it travels in the environment, never in the arguments. */
  password?: string
}

/** Runs the rclone the person named, with their configuration file, as a child of this process. */
export function spawnRclone(setup: RcloneSetup): Rclone {
  return {
    run: (args, options = {}) => new Promise<RcloneResult>((resolve, reject) => {
      const env = { ...process.env, ...(setup.password === undefined ? {} : { RCLONE_CONFIG_PASS: setup.password }) }
      const child = spawn(setup.binary === '' ? 'rclone' : setup.binary, ['--config', setup.configFile, '--ask-password=false', ...args], { env, stdio: ['pipe', 'pipe', 'pipe'], ...(options.signal === undefined ? {} : { signal: options.signal }) })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      child.on('error', (error: NodeJS.ErrnoException) => {
        reject(new RcloneError(error.code === 'ENOENT' ? `rclone was not found (${setup.binary === '' ? 'not on the PATH' : setup.binary}): install it or give its path in the sync settings` : error.message, undefined))
      })
      child.on('close', (code) => { resolve({ code: code ?? -1, stdout, stderr }) })
      child.stdin.on('error', () => undefined)
      child.stdin.end(options.input ?? '')
    }),
  }
}

const CHANGED_IN_TRANSIT = /corrupted on transfer: sizes? differ/

/** The files rclone named as arriving a different size than the server listed, up to a few. */
function changedFiles(lines: readonly string[]): string[] {
  const names = lines.flatMap(line => { const found = /^ERROR\s*: (.+?): .*corrupted on transfer/.exec(line); return found === null ? [] : [found[1]!] })
  return [...new Set(names)].slice(0, 3)
}

/** What rclone said went wrong: its last error line, without the time and the colours, cut short. A file that arrives a different size than the server listed says what usually causes it. */
export function why(result: RcloneResult): string {
  const lines = (result.stderr || result.stdout).split('\n').map(line => line.replace(/\u001b\[[0-9;]*m/g, '').replace(/^\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d /, '').trim()).filter(line => line !== '')
  const line = lines.findLast(entry => /^(ERROR|NOTICE: Failed|CRITICAL)/.test(entry)) ?? lines.at(-1) ?? `rclone stopped with code ${result.code}`
  const shown = line.length > 300 ? `${line.slice(0, 300)}…` : line
  if (!CHANGED_IN_TRANSIT.test(line)) return shown
  const files = changedFiles(lines)
  return `${shown} — something between this device and the server changes files on the way${files.length === 0 ? '' : ` (${files.join(', ')})`}; a proxy or CDN that adds content to HTML pages is the usual cause: turn off its response rewriting for the server, or reach the server directly`
}
