// Loaded with `node --import` into a host: its `/bin/ps` is the real one, started
// E2E_PS_DELAY_S seconds late, like a ps stuck reading one process's arguments (#5019).
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'

const delay = process.env.E2E_PS_DELAY_S ?? '20'
const slow = (file, args) =>
  file === '/bin/ps'
    ? ['/bin/sh', ['-c', `sleep ${delay}; exec /bin/ps "$@"`, 'sh', ...args]]
    : [file, args]

for (const name of ['execFile', 'execFileSync']) {
  const real = childProcess[name]

  childProcess[name] = (file, args, ...rest) => real(...slow(file, args), ...rest)
}
syncBuiltinESMExports()
