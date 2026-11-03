import { t } from '../../i18n/index.ts'

import type { AgentDevice, SshJoinProblem } from '../../api/device-types.ts'

/** Each computer's id and whether it was online, before connecting a new one. */
export const deviceSnapshot = (devices: AgentDevice[]) =>
  new Map(devices.map((device) => [device.deviceId, Boolean(device.online)]))

/** The computer the join brought online: a new one, or one that was offline (a machine joined again). */
export function joinedDevice(
  before: Map<string, boolean>,
  devices: AgentDevice[],
): AgentDevice | undefined {
  return devices.find((device) => device.online && before.get(device.deviceId) !== true)
}

/** Why connecting over SSH stopped, and what the user can do instead. */
export function sshJoinNotice(problem: SshJoinProblem | 'timeout', host: string) {
  switch (problem) {
    case 'no-ssh':
      return {
        title: t('SSH is not available on this computer'),
        description: t('Install OpenSSH, or run the command on the machine yourself.'),
      }
    case 'host-key':
      return {
        title: t('{host} is not a trusted host yet', { host }),
        description: t(
          'Run ssh {host} once in a terminal to accept its key, or run the command on the machine yourself.',
          { host },
        ),
      }
    case 'auth':
      return {
        title: t('Could not sign in to {host}', { host }),
        description: t(
          'Desktop signs in only with your SSH keys and agent, never a password. Add a key, or run the command on the machine yourself.',
        ),
      }
    case 'unreachable':
      return {
        title: t('Could not reach {host}', { host }),
        description: t(
          'Check the host and your network, or run the command on the machine yourself.',
        ),
      }
    case 'timeout':
      return {
        title: t('{host} has not come online yet', { host }),
        description: t(
          'The agent was started there. Its log is ~/.nuphos-agent.log on that machine.',
        ),
      }
    case 'failed':
      return {
        title: t('Setup failed on {host}', { host }),
        description: t('See the output, or run the command on the machine yourself.'),
      }
  }
}
