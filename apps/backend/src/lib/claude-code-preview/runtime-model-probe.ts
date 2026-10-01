// Fixed, shell-free program executed inside the selected managed runtime.
// It initializes a disposable native ACP session, never sends a prompt, and
// prints only model metadata. Credentials and adapter diagnostics stay private.
export const RUNTIME_MODEL_PROBE = String.raw`
const { spawn } = await import('node:child_process');
const provider = process.argv[1];
const requestedModel = process.argv[2];
let sessionId;
let models;
if (!['codex', 'claude-code'].includes(provider)) process.exit(1);
const child = spawn(provider === 'codex' ? 'codex-acp' : 'claude-agent-acp', [], {
  env: Object.fromEntries(['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'CLAUDE_CODE_OAUTH_TOKEN'].filter(key => typeof process.env[key] === 'string').map(key => [key, process.env[key]])),
  cwd: '/workspace', stdio: ['pipe', 'pipe', 'ignore'], detached: true,
});
const stop = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
process.on('exit', stop);
process.on('SIGTERM', () => process.exit(1));
process.on('SIGINT', () => process.exit(1));
const timer = setTimeout(() => process.exit(1), 25000);
child.on('error', () => process.exit(1));
child.on('exit', () => process.exit(1));
child.stdout.setEncoding('utf8');
let pending = '';
const send = (id, method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
child.stdout.on('data', chunk => {
  pending += chunk.toString();
  if (pending.length > 1024 * 1024) process.exit(1);
  let newline;
  while ((newline = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, newline);
    pending = pending.slice(newline + 1);
    let frame;
    try { frame = JSON.parse(line); } catch { continue; }
    if (frame.method && frame.id !== undefined) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: 'Unavailable during model discovery' } }) + '\n');
    } else if (frame.id === 1) {
      if (frame.error) process.exit(1);
      send(2, 'session/new', { cwd: '/workspace', mcpServers: [] });
    } else if (frame.id === 2 || frame.id === 3) {
      if (frame.error) process.exit(1);
      const result = frame.result;
      if (!Array.isArray(result?.configOptions)) process.exit(1);
      const option = result.configOptions.find(o => o.category === 'model' || o.id === 'model');
      if (!Array.isArray(option?.options)) process.exit(1);
      if (frame.id === 2) {
        sessionId = result.sessionId;
        models = option.options.filter(o => typeof o?.value === 'string' && o.value.length > 0 && o.value.length <= 500 && typeof o.name === 'string' && o.name.length > 0 && o.name.length <= 200)
          .map(o => ({ id: o.value, name: o.name, ...(typeof o.description === 'string' ? { description: o.description.slice(0, 1000) } : {}) }));
        if (models.length > 500) process.exit(1);
        if (requestedModel && requestedModel !== option.currentValue) {
          if (!models.some(o => o.id === requestedModel)) process.exit(1);
          send(3, 'session/set_config_option', { sessionId, configId: option.id, value: requestedModel });
          continue;
        }
      }
      if (requestedModel && option.currentValue !== requestedModel) process.exit(1);
      const effort = result.configOptions.find(o => o.category === 'thought_level' || ['reasoning_effort', 'effort', 'thinking'].includes(o.id));
      const fast = result.configOptions.find(o => ['fast-mode', 'fast_mode', 'fast'].includes(o.id));
      const controls = typeof option.currentValue === 'string' ? {
        modelId: option.currentValue,
        effort: Array.isArray(effort?.options) ? effort.options.filter(o => typeof o?.value === 'string' && o.value.length > 0 && o.value.length <= 100 && typeof o.name === 'string' && o.name.length <= 200).map(o => ({ value: o.value, name: o.name })) : [],
        fast: ['on', 'off'].every(value => fast?.options?.some(o => o.value === value)),
        ...(fast?.currentValue === 'on' || fast?.currentValue === 'off' ? { defaultFast: fast.currentValue } : {}),
      } : undefined;
      clearTimeout(timer);
      child.removeAllListeners('exit');
      stop();
      process.stdout.write(JSON.stringify({ models, controls }), () => process.exit(0));
    }
  }
});
send(1, 'initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'nuphos-model-discovery', version: '1' } });
`
