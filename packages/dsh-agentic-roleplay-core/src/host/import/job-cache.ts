import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite } from '../atomic-write.ts'
import { IMPORT_FOLDER } from './store.ts'
import type { ChildJob, RunJob } from './run.ts'

const FOLDER = 'jobs'

const folderOf = (directory: string): string => join(directory, IMPORT_FOLDER, FOLDER)

/** A job is the same job when its instructions, its question and the shape of its answer are the same. */
const keyOf = (job: { persona: string; prompt: string; result: unknown }): string => createHash('sha256').update(JSON.stringify([job.persona, job.prompt, job.result])).digest('hex')

/**
 * Keeps the answer of every job that finished, so that a step run again after a failure, a stop or a restart asks only for the jobs that did not finish. An answer that the
 * job's own check refuses now is asked for again.
 */
export function cachedJobs(directory: string, run: RunJob): RunJob {
  return async <T>(job: ChildJob<T>): Promise<T> => {
    const file = join(folderOf(directory), `${keyOf(job)}.json`)
    try {
      const kept = JSON.parse(await readFile(file, 'utf8')) as T
      if (job.check?.(kept) === undefined) return kept
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    const answer = await run<T>(job)
    await atomicWrite(file, JSON.stringify(answer), { createDirectory: true })
    return answer
  }
}

/** Forgets the kept answers: a new survey starts the work over, and a finished import has no use for them. */
export async function forgetJobs(directory: string): Promise<void> {
  await rm(folderOf(directory), { recursive: true, force: true })
}
