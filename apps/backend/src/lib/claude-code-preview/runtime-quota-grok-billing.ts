// Grok keeps its credential to itself and answers its own ACP `_x.ai/billing`.
// One program text for both callers: the cloud runtime's usage probe and a
// Desktop or CLI-host computer reading its own agent, so the two cannot drift.
// It defines `grokBilling(command)`, which resolves to the billing result or to
// `{ error }`; it imports nothing beyond Node, as both run it as plain Node.
export const GROK_BILLING = String.raw`
async function grokBilling(command) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['agent', '--no-leader', 'stdio'], {
      env: { ...process.env, GROK_DISABLE_AUTOUPDATER: '1' },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const send = message => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
    const done = (error, result) => { clearTimeout(timer); child.kill(); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => done(new Error('Grok did not answer')), 10000);
    let buffer = '';
    child.on('error', error => done(error));
    child.stdin.on('error', error => done(error));
    child.stdout.on('data', chunk => {
      buffer += chunk;
      for (let end; (end = buffer.indexOf('\n')) >= 0; buffer = buffer.slice(end + 1)) {
        let message;
        try { message = JSON.parse(buffer.slice(0, end)); } catch { continue; }
        if (message.id === 1) send({ id: 2, method: '_x.ai/billing', params: {} });
        if (message.id === 2) done(message.error && new Error(message.error.message), message.result);
      }
    });
    send({ id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } });
  }).catch(error => ({ error: String(error.message) }));
}
`
