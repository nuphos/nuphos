// Invoked through the backend's authenticated Kubernetes exec channel, or through
// OpenAB's operator-gated `_openab/runtime/login`. stdout is a private protocol, never
// pod logs.
//
// With `--install` the credential is written into this container's real `CODEX_HOME`
// and the final frame carries no credential at all. That is the right shape for a
// runtime Nuphos did not provision: the credential is minted inside the container and
// nothing outside it needs a copy. Without the flag the credential rides the frame,
// which is what the Kubernetes exec path still needs in order to store it in a Secret.
import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { stripVTControlCharacters } from 'node:util'
import { pathToFileURL } from 'node:url'

export function deviceCodePrompt(output) {
  const plain = stripVTControlCharacters(output)
  if (!plain.includes('https://auth.openai.com/codex/device')) return null
  const userCode = /Enter this one-time code[^\n]*\n[ \t]*([A-Za-z0-9-]{4,32})[ \t]*\r?\n/u.exec(
    plain,
  )?.[1]
  return userCode
    ? { type: 'device', verificationUri: 'https://auth.openai.com/codex/device', userCode }
    : null
}

/**
 * What a line on stdin asks for while the account sign-in waits: an OpenAI API key to sign
 * in with instead (`codex login --with-api-key`), or removing the key this runtime uses.
 */
export function loginChoice(line) {
  const text = String(line).trim()
  if (/^sk-(?!ant-)[\w-]{20,400}$/u.test(text)) return { apiKey: text }
  if (text === 'sign-out') return { signOut: true }
  return null
}

export const CODEX_AUTH_DIRECTORY = process.env.NUPHOS_CODEX_AUTH_DIRECTORY ?? '/home/node/.codex'

/**
 * Move the credential into the directory the Codex CLI actually reads. The revision
 * marker is the same one `seed-codex-auth.sh` keeps, so a later bound credential still
 * replaces this one and an ordinary restart still leaves it alone.
 */
export async function installAuthJson(authJson, directory = CODEX_AUTH_DIRECTORY) {
  const revision = createHash('sha256').update(authJson).digest('hex').slice(0, 16)
  const staged = join(directory, 'auth.json.new')

  await mkdir(directory, { recursive: true, mode: 0o700 })
  await writeFile(staged, authJson, { mode: 0o600 })
  await chmod(staged, 0o600)
  await rename(staged, join(directory, 'auth.json'))
  await writeFile(join(directory, '.nuphos-auth-revision'), revision, { mode: 0o600 })
}

/** Removes the login only when it is an API key; an account sign-in is left alone. */
export async function removeApiKey(directory = CODEX_AUTH_DIRECTORY) {
  const auth = await readFile(join(directory, 'auth.json'), 'utf8').then(JSON.parse, () => null)
  if (auth?.auth_mode !== 'apikey') return
  await rm(join(directory, 'auth.json'), { force: true })
  await rm(join(directory, '.nuphos-auth-revision'), { force: true })
}

/**
 * The account sign-in (`--device-auth`), or with `apiKey` the key sign-in, which reads the key
 * from stdin. A key is only accepted with `install`: the path that hands the credential back
 * would carry it out of this container.
 */
export async function runDeviceLogin({
  executable = process.execPath,
  args = ['/opt/nuphos-codex-acp/node_modules/@openai/codex/bin/codex.js'],
  // The child's HOME is the caller's choice, so a test can keep the CLI off the real one.
  home,
  emit = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`),
  install = false,
  authDirectory = CODEX_AUTH_DIRECTORY,
  signal,
  // Lines the person sends while the account sign-in waits (see `loginChoice`).
  input,
  apiKey,
}) {
  if (apiKey !== undefined && (!install || !loginChoice(apiKey)?.apiKey))
    throw new Error('Codex API key refused')
  const directory = await mkdtemp(join(tmpdir(), 'nuphos-codex-login-'))
  let choice
  let lines
  try {
    const child = spawn(
      executable,
      [
        ...args,
        '-c',
        'cli_auth_credentials_store="file"',
        'login',
        apiKey === undefined ? '--device-auth' : '--with-api-key',
      ],
      {
        // Do not inherit transport keys, actor tokens, or another Codex login.
        env: {
          HOME: home,
          CODEX_HOME: directory,
          // An npm-installed `codex` is `#!/usr/bin/env node`, so it needs the PATH that has node.
          PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
          TERM: 'dumb',
        },
        stdio: [apiKey === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        // The npm CLI launches a native child. Cancel the entire process group,
        // otherwise that child keeps the pipes and temporary login home alive.
        detached: process.platform !== 'win32',
      },
    )
    let output = ''
    let announced = false
    const collect = (chunk) => {
      if (announced) return
      output = (output + chunk.toString()).slice(-16_384)
      const prompt = deviceCodePrompt(output)
      if (prompt) {
        announced = true
        output = ''
        emit(prompt)
      }
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.stdin?.on('error', () => {})
    child.stdin?.end(`${apiKey}\n`)
    const code = await new Promise((resolve, reject) => {
      let failure
      const kill = () => {
        if (!child.pid) return
        try {
          if (process.platform === 'win32') child.kill('SIGKILL')
          else process.kill(-child.pid, 'SIGKILL')
        } catch (error) {
          if (error.code !== 'ESRCH') failure = error
        }
      }
      const stop = () => {
        failure = new Error('Codex login stopped')
        kill()
      }
      // A key or a sign-out replaces the account sign-in that is waiting.
      if (install && input && apiKey === undefined) {
        lines = createInterface({ input })
        lines.on('line', (line) => {
          choice ??= loginChoice(line) ?? undefined
          if (choice) kill()
        })
      }
      const timeout = setTimeout(stop, 15 * 60_000)
      signal?.addEventListener('abort', stop, { once: true })
      child.once('error', (error) => {
        failure = error
      })
      child.once('close', (exitCode) => {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', stop)
        failure ? reject(new Error('Codex login stopped')) : resolve(exitCode)
      })
      if (signal?.aborted) stop()
    })
    lines?.close()
    if (choice?.signOut) {
      await removeApiKey(authDirectory)
      emit({ type: 'signedOut' })

      return
    }
    if (choice?.apiKey)
      return await runDeviceLogin({
        executable,
        args,
        home,
        emit,
        install,
        authDirectory,
        signal,
        apiKey: choice.apiKey,
      })
    if (code !== 0) throw new Error('Codex login did not complete')
    const authJson = await readFile(join(directory, 'auth.json'), 'utf8')
    if (authJson.length > 64 * 1024) throw new Error('Unexpected Codex login response')
    if (!install) {
      emit({ type: 'authenticated', authJson })

      return
    }
    await installAuthJson(authJson, authDirectory)
    emit({ type: 'authenticated' })
  } finally {
    lines?.close()
    await rm(directory, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController()
  for (const event of ['SIGTERM', 'SIGINT']) process.once(event, () => controller.abort())
  process.stdout.on('error', () => controller.abort())
  try {
    const install = process.argv.includes('--install')
    // The Desktop's own sign-in for this computer: one line on stdin, the key, or a sign-out.
    const direct = process.argv.includes('--api-key') || process.argv.includes('--sign-out')
    const line = direct
      ? await new Promise((resolve) => {
          const lines = createInterface({ input: process.stdin })
          lines.once('line', (value) => {
            resolve(value)
            lines.close()
          })
          lines.once('close', () => resolve(''))
        })
      : undefined
    const login = {
      ...(process.env.CODEX_EXECUTABLE
        ? { executable: process.env.CODEX_EXECUTABLE, args: [] }
        : {}),
      home: process.env.HOME ?? '/home/node',
      signal: controller.signal,
      install,
    }

    if (process.argv.includes('--sign-out')) {
      await removeApiKey()
      process.stdout.write(`${JSON.stringify({ type: 'signedOut' })}\n`)
    } else if (direct) await runDeviceLogin({ ...login, apiKey: line })
    else await runDeviceLogin({ ...login, input: process.stdin })
  } catch {
    // Provider output can contain sensitive values; report only a fixed error.
    process.stdout.write(
      `${JSON.stringify({ type: 'error', message: 'Sign-in did not complete. Retry and check that device-code login is enabled in ChatGPT security settings.' })}\n`,
    )
    process.exitCode = 1
  }
}
