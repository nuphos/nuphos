import { t } from '../../i18n/index.ts'

import type { SshJoinProblem } from '../../api/device-types.ts'

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
