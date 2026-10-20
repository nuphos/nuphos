/**
 * Moves one runtime Nuphos hosts onto the device path (NUPS-1234): its pod restarts as the
 * `nuphos agent` host, joins as a team device, and Nuphos reaches it through that device's
 * tunnel. `--detach` puts it back on the direct connection. Either way the provisioner
 * restarts the pod on its next pass, and conversations keep their runtime.
 *
 *   bun run scripts/runtime-device-join.ts --team <teamId> --runtime <runtimeId>
 *   bun run scripts/runtime-device-join.ts --team <teamId> --runtime <runtimeId> --detach
 */
import {
  detachHostedRuntimeDevice,
  joinHostedRuntimeAsDevice,
} from '@/lib/claude-code-preview/runtime-device-join'
import { closeDb, connectDb } from '@/lib/db'

function arg(name: string): string {
  const value = process.argv[process.argv.indexOf(`--${name}`) + 1]

  if (!process.argv.includes(`--${name}`) || !value) {
    console.error(`--${name} is required`)
    process.exit(1)
  }

  return value
}

const teamId = arg('team')
const runtimeId = arg('runtime')

await connectDb()
try {
  if (process.argv.includes('--detach'))
    console.log(
      (await detachHostedRuntimeDevice(teamId, runtimeId))
        ? 'Detached; the pod restarts on the direct connection.'
        : 'The runtime was not joined as a device.',
    )
  else {
    const device = await joinHostedRuntimeAsDevice(teamId, runtimeId)

    console.log(`Joining as device ${device.deviceId}; the pod restarts as the CLI host.`)
  }
} finally {
  await closeDb()
}
