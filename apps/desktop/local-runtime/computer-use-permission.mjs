// The SDK requests Computer Use app approval before performing the native operation.
export async function nuphosAuthorizeComputerUse(params, signal, execute) {
  if (process.platform !== 'darwin' || params._meta?.connector_id !== 'computer-use') return
  const client = process.env.NUPHOS_CUA_PERMISSION_CLIENT

  if (!client) throw new Error('Native Computer Use authorization helper is unavailable')
  // No timeout on human consent; canceling the turn still aborts the waiter.
  execute ??= (await import('node:util')).promisify((await import('node:child_process')).execFile)
  await execute(client, [], { signal })
}
