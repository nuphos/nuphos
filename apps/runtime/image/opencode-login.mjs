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
//
// Amazon Bedrock has no sign-in of its own in OpenCode: it takes a Bedrock API key, or
// AWS credentials and a region from OpenCode's config. Both are asked for here; the
// config is OpenCode's global one in this container, not environment variables, which
// every shell command the agent runs would inherit.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
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
// How long a 2.x attempt is polled when OpenCode does not say when it expires.
const ATTEMPT_MS = 10 * 60_000
const BEDROCK = 'amazon-bedrock'
const BEDROCK_METHODS = [
  { value: 'api-key', label: 'Bedrock API key' },
  { value: 'access-key', label: 'AWS access key' },
]
const AWS_REGION = /^[a-z]{2}(?:-gov)?-[a-z]+-\d{1,2}$/u
// A computer running OpenCode as a local agent names its own CLI and the home it runs with.
const HOME = process.env.NUPHOS_AGENT_HOME || process.env.HOME || '/home/node'
const OPENCODE_EXECUTABLE = process.env.NUPHOS_AGENT_EXECUTABLE || 'opencode'
const CONFIG_FILE = join(HOME, '.config', 'opencode', 'opencode.json')

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
      ...(connected.includes(id) ? { hint: 'Connected' } : {}),
    }))
}

/** OpenCode's server, on loopback only and behind a password nobody else holds. */
export function startServer({ home }) {
  const password = randomBytes(24).toString('hex')
  const child = spawn(OPENCODE_EXECUTABLE, ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
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

/**
 * Sets Bedrock's options in OpenCode's config, keeping everything else in it. Saved
 * credentials are replaced, not merged, so switching methods leaves nothing behind.
 */
export async function writeBedrockOptions(file, options) {
  let config = {}
  try {
    config = JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw new LoginError('OpenCode config is not plain JSON')
  }
  const kept = { ...config.provider?.[BEDROCK]?.options }
  for (const key of ['accessKeyId', 'secretAccessKey', 'sessionToken', 'apiKey']) delete kept[key]
  config.provider = {
    ...config.provider,
    [BEDROCK]: { ...config.provider?.[BEDROCK], options: { ...kept, ...options } },
  }
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${String(process.pid)}.tmp`
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, file)
}

export async function runOpenCodeLogin({
  server,
  lines,
  emit = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`),
  fetchImpl = fetch,
  configFile = CONFIG_FILE,
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
  // OpenCode answers 200 with `false` when a credential was not saved.
  const saved = async (method, path, body) => {
    if ((await api(method, path, body)) !== true) throw new LoginError('OpenCode did not sign in')
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
  if (providerID === BEDROCK) {
    const how = await choose(`Sign in to ${name}`, BEDROCK_METHODS)
    const region = await input({ message: 'AWS region', placeholder: 'us-east-1' })
    if (!AWS_REGION.test(region)) throw new LoginError('Not an AWS region')
    if (how === 'api-key') {
      const key = await input({ message: 'Amazon Bedrock API key', secret: true })
      await saved('PUT', `/auth/${BEDROCK}`, { type: 'api', key })
      await writeBedrockOptions(configFile, { region })
    } else {
      const accessKeyId = await input({ message: 'AWS access key ID', placeholder: 'AKIA…' })
      const secretAccessKey = await input({
        message:
          'AWS secret access key. Every conversation on this agent can read it, so use a key allowed only bedrock:InvokeModel*.',
        secret: true,
      })
      // A saved Bedrock API key would win over these.
      await saved('DELETE', `/auth/${BEDROCK}`)
      await writeBedrockOptions(configFile, { region, accessKeyId, secretAccessKey })
    }
    return emit({ type: 'authenticated' })
  }
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
    await saved('PUT', `/auth/${encodeURIComponent(providerID)}`, {
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
    await saved('POST', `${path}/callback`, { method: index, code: await answer() })
    return emit({ type: 'authenticated' })
  }
  // OpenCode waits for the approval itself: a device page it polls, or a listener in
  // this container that the browser cannot reach, so the user pastes its address back.
  const redirect = loopbackRedirect(url)
  emit({ type: 'browser', url, instructions, ...(redirect ? { paste: 'address' } : {}) })
  const approved = saved('POST', `${path}/callback`, { method: index })
  if (redirect) {
    // A callback that fails first, such as OpenCode's listener timing out, ends the
    // sign-in now rather than after a paste that can no longer help.
    const failed = approved.then(() => new Promise(() => {}))
    const address = pastedAddress(await Promise.race([answer(), failed]), redirect)
    if (!address) throw new LoginError('Not the sign-in address')
    await fetchImpl(address, { redirect: 'manual' }).catch(() => {})
  }
  await approved
  emit({ type: 'authenticated' })
}

/** Whether a 2.x form field applies, given the answers so far. */
export function fieldApplies(field, answers) {
  return (field.when ?? []).every(({ key, op, value }) =>
    op === 'eq' ? answers[key] === value : answers[key] !== value,
  )
}

/** OpenCode 2.x lists its integrations here; 1.x answers the path with its web app. */
export async function isOpenCodeV2(server, fetchImpl = fetch) {
  const response = await fetchImpl(`${server.base}/api/integration`, {
    headers: { authorization: server.authorization },
  }).catch(() => undefined)
  if (!response?.ok) return false
  return response.json().then(
    (body) => Array.isArray(body?.data),
    () => false,
  )
}

/** Asks for every field a 2.x method's form shows, in order; hidden fields keep their default. */
async function formAnswers(form, { choose, input }) {
  const answers = {}
  for (const field of form ?? []) {
    if (!fieldApplies(field, answers)) continue
    if (field.hidden) {
      if (field.default !== undefined) answers[field.key] = field.default
      continue
    }
    const message = field.title ?? field.key
    // A custom field takes a typed value; its options are only suggestions.
    answers[field.key] =
      field.options?.length && !field.custom
        ? await choose(
            message,
            field.options.map(({ value, label, description }) => ({
              value,
              label: label ?? value,
              ...(description ? { hint: description } : {}),
            })),
          )
        : await input({ message, ...(field.placeholder ? { placeholder: field.placeholder } : {}) })
  }
  return Object.keys(answers).length ? { answer: answers } : {}
}

/**
 * OpenCode 2.x calls providers integrations and keeps the credential in its own database.
 * Same frames as the 1.x flow above.
 */
export async function runOpenCodeLoginV2({
  server,
  lines,
  emit = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`),
  fetchImpl = fetch,
  pollMs = 2000,
}) {
  const api = async (method, path, body) => {
    const response = await fetchImpl(`${server.base}${path}`, {
      method,
      headers: { authorization: server.authorization, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new LoginError(`OpenCode answered ${String(response.status)}`)
    return response.status === 204 ? undefined : (await response.json()).data
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
  // OpenCode finishes an OAuth or command attempt itself, so it is polled until it expires.
  const settled = async (path, time) => {
    const deadline = Number.isFinite(time?.expires) ? time.expires : Date.now() + ATTEMPT_MS
    while (Date.now() < deadline) {
      const { status, message } = await api('GET', path)
      if (status === 'complete') return
      if (status !== 'pending') throw new LoginError(message ?? `Sign-in ${status}`)
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
    throw new LoginError('Sign-in expired')
  }

  // Environment variables are not a sign-in; an integration with only those is not offered.
  const all = (await api('GET', '/api/integration')).filter((integration) =>
    (integration.methods ?? []).some((method) => method.type !== 'env'),
  )
  const connected = all.filter(({ connections }) => connections?.length).map(({ id }) => id)
  const integrationID = await choose('Choose a model provider', providerOptions({ all, connected }))
  const integration = all.find(({ id }) => id === integrationID)
  const offered = integration.methods.filter((method) => method.type !== 'env')
  const choice =
    offered.length === 1
      ? '0'
      : await choose(
          `Sign in to ${integration.name}`,
          offered.map((method, i) => ({
            value: String(i),
            label: method.label ?? (method.type === 'key' ? API_KEY.label : method.type),
          })),
        )
  const method = offered[Number(choice)]
  const filled = await formAnswers(method.form, { choose, input })
  const base = `/api/integration/${encodeURIComponent(integrationID)}/connect`

  if (method.type === 'key') {
    const label = method.label ?? API_KEY.label
    const key = await input({ message: `${integration.name} ${label}`, secret: true })
    await api('POST', `${base}/key`, { key, ...filled })
  } else if (method.type === 'external') {
    await api('POST', `${base}/external`, { methodID: method.id, ...filled })
  } else if (method.type === 'command') {
    const { attemptID, time } = await api('POST', `${base}/command`, { methodID: method.id })
    await settled(`${base}/command/${encodeURIComponent(attemptID)}`, time)
  } else if (method.type === 'oauth') {
    const attempt = await api('POST', `${base}/oauth`, { methodID: method.id, ...filled })
    const path = `${base}/oauth/${encodeURIComponent(attempt.attemptID)}`
    const { url, instructions } = attempt
    if (attempt.mode === 'code') {
      emit({ type: 'browser', url, instructions, paste: 'code' })
      await api('POST', `${path}/complete`, { code: await answer() })
      await settled(path, attempt.time)
    } else {
      // As in 1.x, a loopback listener the browser cannot reach gets its address pasted back.
      const redirect = loopbackRedirect(url)
      emit({ type: 'browser', url, instructions, ...(redirect ? { paste: 'address' } : {}) })
      const done = settled(path, attempt.time)
      const pasted = redirect && (await Promise.race([answer(), done.then(() => undefined)]))
      if (pasted) {
        const address = pastedAddress(pasted, redirect)
        if (!address) throw new LoginError('Not the sign-in address')
        await fetchImpl(address, { redirect: 'manual' }).catch(() => {})
      }
      await done
    }
  } else {
    throw new LoginError('Unsupported sign-in method')
  }
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
  // Whatever ends this process, the server goes with it.
  process.once('exit', () => server?.stop())
  process.stdout.on('error', fail)
  setTimeout(fail, 15 * 60_000).unref()
  try {
    server = await startServer({ home: HOME })
    const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]()
    await ((await isOpenCodeV2(server)) ? runOpenCodeLoginV2 : runOpenCodeLogin)({ server, lines })
    server.stop()
    process.exit(0)
  } catch {
    fail()
  }
}
