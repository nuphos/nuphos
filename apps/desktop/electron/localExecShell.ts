import { existsSync } from 'node:fs'

// The agent writes bash-flavoured commands (`for … do … done`, `[[ ]]`,
// `$(…)`), so local_exec must run a POSIX shell — NOT the user's login shell.
// fish rejects that syntax at parse time (exit 127 before a single command
// runs), so every structured command failed for fish users. Login-shell
// PATH/env still reaches the command through localExecEnv()'s resolveShellEnv()
// overlay, so plain `-c` is enough — and it avoids sourcing rc files twice.
export function localExecShellFor(
  platform: NodeJS.Platform,
  exists: (path: string) => boolean = existsSync,
): [string, string] {
  if (platform === 'win32') return ['cmd.exe', '/c']

  return [exists('/bin/bash') ? '/bin/bash' : '/bin/sh', '-c']
}

export function localExecShell(): [string, string] {
  return localExecShellFor(process.platform)
}
