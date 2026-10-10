// Run through OpenAB's operator-gated `_openab/runtime/login`. stdout is a private
// NDJSON protocol, never pod logs; stdin carries one answer per line.
//
// OpenCode signs in to any of its providers, each in its own way: an API key, an OAuth
// device page, a browser that hands back a code or lands on a loopback address, plus
// whatever fields a method asks for first. This drives OpenCode's own server, so every
// method OpenCode offers is offered here, and OpenCode writes the credential to
// `$XDG_DATA_HOME/opencode/auth.json` in this container; no frame carries it.
//
// Frames: `choose` {message, options: [{value, label, hint?}]} and `input` {message,
// placeholder?, secret?} each wait for one line; `browser` {url, instructions?, paste?}
// waits for the pasted code or address when `paste` is set, and otherwise for OpenCode
// to see the approval itself.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

// Listed first; every other provider follows by name.
const FEATURED = [
  'openai',
  'anthropic',
  'github-copilot',
  'google',
  'xai',
  'openrouter',
  'opencode',
]
const API_KEY = { type: 'api', label: 'API key' }

class LoginError extends Error {}

/** Where an OAuth page sends the browser back to, when that is a listener in this container. */
export function loopbackRedirect(url) {
  try {
    const redirect = new URL(new URL(url).searchParams.get('redirect_uri') ?? '')
    return redirect.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(redirect.hostname)
      ? redirect
      : undefined
  } catch {
    return undefined
  }
}

/** The address the browser ended on, accepted only for the listener the page named. */
export function pastedAddress(text, redirect) {
  try {
    const url = new URL(text)
    return url.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(url.hostname) &&
      url.port === redirect.port &&
      url.pathname === redirect.pathname
      ? url
      : undefined
  } catch {
    return undefined
  }
}

export function providerOptions({ all, connected }) {
  const rank = (id) => (FEATURED.includes(id) ? FEATURED.indexOf(id) : FEATURED.length)
  return [...all]
    .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name))
    .map(({ id, name }) => ({
      value: id,
      label: name,
      ...(connected.includes(id) ? { hint: 'Signed in' } : {}),
    }))
}

/** OpenCode's server, on loopback only and behind a password nobody else holds. */
export function startServer({ home }) {
  const password = randomBytes(24).toString('hex')
  const child = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
    // Not the gateway's environment: no transport keys or session tokens.
    env: {
      HOME: home,
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_DISABLE_AUTOUPDATE: '1',
      TERM: 'dumb',
    },
    cwd: home,
    // In this helper's process group, so stopping the sign-in stops the server too.
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const stop = () => child.kill('SIGKILL')
  return new Promise((resolve, reject) => {
    let output = ''
    child.once('error', reject)
    child.once('close', () => reject(new LoginError('OpenCode server exited')))
    child.stdout.on('data', (chunk) => {
      output = (output + chunk.toString()).slice(-4096)
      const base = /listening on (http:\/\/127\.0\.0\.1:\d+)/u.exec(output)?.[1]
      if (base)
        resolve({
          base,
          authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
          stop,
        })
    })
  })
}

export async function runOpenCodeLogin({
  server,
  lines,
  emit = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`),
  fetchImpl = fetch,
}) {
  const api = async (method, path, body) => {
    const response = await fetchImpl(`${server.base}${path}`, {
      method,
      headers: { authorization: server.authorization, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new LoginError(`OpenCode answered ${String(response.status)}`)
    return response.json()
  }
  const answer = async () => {
    const { value, done } = await lines.next()
    if (done) throw new LoginError('No answer')
    return value.trim()
  }
  const choose = async (message, options) => {
    emit({ type: 'choose', message, options })
    const value = await answer()
    if (!options.some((option) => option.value === value)) throw new LoginError('Unknown choice')
    return value
  }
  const input = async (frame) => {
    emit({ type: 'input', ...frame })
    const value = await answer()
    if (!value) throw new LoginError('Empty answer')
    return value
  }

  const [providers, methods] = await Promise.all([
    api('GET', '/provider'),
    api('GET', '/provider/auth'),
  ])
  const providerID = await choose('Choose a model provider', providerOptions(providers))
  const name = providers.all.find((provider) => provider.id === providerID).name
  const offered = methods[providerID]?.length ? methods[providerID] : [API_KEY]
  const index =
    offered.length === 1
      ? 0
      : Number(
          await choose(
            `Sign in to ${name}`,
            offered.map((method, i) => ({ value: String(i), label: method.label })),
          ),
        )
  const method = offered[index]

  const inputs = {}
  for (const prompt of method.prompts ?? []) {
    if (prompt.when) {
      const value = inputs[prompt.when.key]
      if (value === undefined || (value === prompt.when.value) !== (prompt.when.op === 'eq'))
        continue
    }
    inputs[prompt.key] =
      prompt.type === 'select'
        ? await choose(
            prompt.message,
            prompt.options.map(({ value, label, hint }) => ({
              value,
              label,
              ...(hint ? { hint } : {}),
            })),
          )
        : await input({
            message: prompt.message,
            ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
          })
  }

  if (method.type === 'api') {
    const key = await input({ message: `${name} API key`, secret: true })
    await api('PUT', `/auth/${encodeURIComponent(providerID)}`, {
      type: 'api',
      key,
      ...(Object.keys(inputs).length ? { metadata: inputs } : {}),
    })
    return emit({ type: 'authenticated' })
  }

  const path = `/provider/${encodeURIComponent(providerID)}/oauth`
  const authorization = await api('POST', `${path}/authorize`, { method: index, inputs })
  if (!authorization) throw new LoginError('No authorization')
  const { url, instructions } = authorization
  if (authorization.method === 'code') {
    emit({ type: 'browser', url, instructions, paste: 'code' })
    await api('POST', `${path}/callback`, { method: index, code: await answer() })
    return emit({ type: 'authenticated' })
  }
  // OpenCode waits for the approval itself: a device page it polls, or a listener in
  // this container that the browser cannot reach, so the user pastes its address back.
  const redirect = loopbackRedirect(url)
  emit({ type: 'browser', url, instructions, ...(redirect ? { paste: 'address' } : {}) })
  const approved = api('POST', `${path}/callback`, { method: index })
  if (redirect) {
    const address = pastedAddress(await answer(), redirect)
    if (!address) throw new LoginError('Not the sign-in address')
    await fetchImpl(address, { redirect: 'manual' }).catch(() => {})
  }
  await approved
  emit({ type: 'authenticated' })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let server
  // Provider output can contain sensitive values; report only a fixed reason.
  const fail = () => {
    server?.stop()
    process.stdout.write(`${JSON.stringify({ type: 'error', reason: 'failed' })}\n`)
    process.exit(1)
  }
  for (const event of ['SIGTERM', 'SIGINT']) process.once(event, fail)
  process.stdout.on('error', fail)
  setTimeout(fail, 15 * 60_000).unref()
  try {
    server = await startServer({ home: process.env.HOME ?? '/home/node' })
    await runOpenCodeLogin({
      server,
      lines: createInterface({ input: process.stdin })[Symbol.asyncIterator](),
    })
    server.stop()
    process.exit(0)
  } catch {
    fail()
  }
}
