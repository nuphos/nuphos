import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** Ask the official CLI, without opening a conversation or reading its credentials. */
export function antigravityStatus(executable = 'agy', env = process.env) {
  return new Promise((resolve) => {
    execFile(
      executable,
      ['models'],
      { env, timeout: 10_000, maxBuffer: 128 * 1024 },
      (error, stdout, stderr) => {
        if (!error) return resolve(true)
        const output = `${stdout}${stderr}`
        resolve(output.includes('Please sign in to view available models.') ? false : null)
      },
    )
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.stdout.write(
    `${JSON.stringify(await antigravityStatus(process.env.NUPHOS_AGENT_EXECUTABLE))}\n`,
  )
