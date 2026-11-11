import { execFile } from 'node:child_process'

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
