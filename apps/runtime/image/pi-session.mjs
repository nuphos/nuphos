import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

function writePrivateJson(path, value) {
  const temporary = `${path}.${randomUUID()}`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

function linkConfiguration(source, target) {
  if (!existsSync(source)) return
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  if (existsSync(target)) {
    if (!lstatSync(target).isSymbolicLink() || readlinkSync(target) !== source)
      throw new Error(`Pi configuration path is already occupied: ${target}`)
    return
  }
  symlinkSync(source, target)
}

export function piMcpConfiguration(servers) {
  const result = Object.create(null)
  const names = new Set()
  for (const server of servers) {
    const name = server.name
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name))
      throw new Error(
        'Pi MCP server names must contain only letters, digits, underscores or hyphens',
      )
    const canonical = name.replaceAll('-', '_')
    if (names.has(canonical)) throw new Error(`Duplicate Pi MCP server: ${name}`)
    names.add(canonical)
    const pairs = (values = []) =>
      Object.fromEntries(
        values.map(({ name: key, value }) => {
          if (typeof key !== 'string' || typeof value !== 'string')
            throw new Error(`Invalid Pi MCP configuration for ${name}`)
          // ACP 提供的配置值按照字面内容传递，避免 Pi 执行插值。
          return [key, value.replaceAll('$', () => '$$').replace(/^!/, () => '$!')]
        }),
      )
    if (server.type === 'http') {
      const url = new URL(server.url)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid Pi MCP HTTP URL')
      result[name] = { url: server.url, headers: pairs(server.headers), exposure: 'direct' }
    } else if (!server.type || server.type === 'stdio') {
      if (typeof server.command !== 'string' || !server.command)
        throw new Error(`Missing Pi MCP command for ${name}`)
      if (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== 'string'))
        throw new Error(`Invalid Pi MCP arguments for ${name}`)
      result[name] = {
        command: server.command,
        args: server.args,
        env: pairs(server.env),
        exposure: 'direct',
      }
    } else throw new Error(`Unsupported Pi MCP transport: ${server.type}`)
  }
  return { mcpServers: result }
}

export function preparePiSession(params, env, runtimeEnv) {
  const context = params._meta?.['ai.nuphos/session']
  const id = context?.env?.NUPHOS_SESSION_ID
  if (typeof id !== 'string' || !id || !env.NUPHOS_SESSION_HOME)
    throw new Error('Pi runtime requires a Nuphos conversation and isolated session home')
  const runtimeHome = resolve(runtimeEnv.HOME)
  const source = resolve(runtimeEnv.NUPHOS_PI_CONFIG_DIR || join(runtimeHome, '.pi', 'agent'))
  const agentDir = join(env.NUPHOS_SESSION_HOME, '.pi', 'agent')
  const conversation = createHash('sha256').update(id).digest('hex')
  const shared = join(runtimeHome, '.nuphos', 'pi-conversations', conversation)
  for (const directory of [agentDir, join(shared, 'sessions'), join(shared, 'acp')])
    mkdirSync(directory, { recursive: true, mode: 0o700 })
  // 模型账户属于 runtime；MCP 和工具配置属于当前会话成员。
  for (const name of ['models.json', 'auth.json'])
    linkConfiguration(join(source, name), join(agentDir, name))
  linkConfiguration(join(shared, 'acp'), join(env.HOME, '.pi', 'pi-acp'))
  const settingsPath = join(source, 'settings.json')
  const original = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {}
  const keys = [
    'defaultProvider',
    'defaultModel',
    'defaultThinkingLevel',
    'enabledModels',
    'httpProxy',
  ]
  const settings = Object.fromEntries(
    keys.filter((key) => original[key] !== undefined).map((key) => [key, original[key]]),
  )
  const workspace = resolve(runtimeEnv.NUPHOS_RUNTIME_WORKSPACE || '/workspace')
  writePrivateJson(join(agentDir, 'settings.json'), {
    ...settings,
    quietStartup: true,
    enableInstallTelemetry: false,
    enableAnalytics: false,
    defaultProjectTrust: 'never',
    sessionDir: join(shared, 'sessions'),
    skills: [join(workspace, '.claude', 'skills')],
  })
  writePrivateJson(join(agentDir, 'mcp.json'), piMcpConfiguration(params.mcpServers ?? []))
  return {
    ...env,
    PI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_SESSION_DIR: join(shared, 'sessions'),
  }
}
