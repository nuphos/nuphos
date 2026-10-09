import { useCallback, useState } from 'react'

import { api } from '../../../api'
import { Modal } from '../../../components/Modal'
import { Button } from '../../../components/ui/button'
import { toast } from '../../../components/ui/toast'
import { useLocalRuntimeState } from '../../../hooks/useLocalRuntimeState'
import { AddAgentDialog } from '../../settings/AddAgentDialog'
import { LocalAgentSignIn } from '../../settings/LocalAgentSignIn'

/** Create and join paths offer local sign-in and optional cloud setup together. */
export function useLocalAgentSetup(onFinish: (teamId: string | null) => void) {
  const local = useLocalRuntimeState()
  const [teamId, setTeamId] = useState<string | null | undefined>(undefined)
  const [addingCloud, setAddingCloud] = useState(false)
  const [checkingRole, setCheckingRole] = useState(false)
  const providers = (['claude-code', 'codex'] as const).filter((provider) => {
    const agent = local?.agents[provider]

    return agent?.available && agent.cli?.installed
  })
  const showLocal = providers.length > 0
  const finish = useCallback(
    (nextTeamId: string | null) => {
      if (nextTeamId || showLocal) setTeamId(nextTeamId)
      else onFinish(nextTeamId)
    },
    [showLocal, onFinish],
  )

  async function setupCloud() {
    if (!teamId || checkingRole) return
    setCheckingRole(true)
    try {
      const teams = await api.atlasListTeams()

      if (teams.find((team) => team.id === teamId)?.role !== 'ADMINISTRATOR') {
        toast.info('Ask a workspace administrator to set up a cloud agent')

        return
      }
      setAddingCloud(true)
    } catch (error) {
      toast.apiError('Could not open cloud agent setup', error)
    } finally {
      setCheckingRole(false)
    }
  }

  const dialog =
    teamId !== undefined &&
    (addingCloud && teamId ? (
      <AddAgentDialog teamId={teamId} onClose={() => setAddingCloud(false)} />
    ) : (
      <Modal
        open
        title="Set up your agents"
        onClose={() => {
          if (!checkingRole) onFinish(teamId)
        }}
        closeOnBackdrop={false}
      >
        <div className="space-y-5 p-5 titlebar-no-drag">
          {providers.map((provider) => {
            const cli = local?.agents[provider].cli
            const connected = cli?.installed && cli.loggedIn === true
            const name = provider === 'codex' ? 'Codex' : 'Claude'

            return (
              <section key={provider} className="space-y-2">
                <h3 className="text-[13px] font-medium text-main">{name} on this computer</h3>
                <p className="text-[13px] text-secondary">
                  {connected
                    ? `${name} is signed in. Keep Nuphos open while your local agent works.`
                    : `Sign in to connect ${name} to Nuphos on this computer.`}
                </p>
                {!connected && <LocalAgentSignIn provider={provider} />}
              </section>
            )
          })}
          {teamId && (
            <section className="space-y-2">
              <h3 className="text-[13px] font-medium text-main">Also set up a cloud agent?</h3>
              <p className="text-[13px] text-secondary">
                Tasks running on a cloud agent can keep going when your computer is closed. Continue
                those conversations from your phone. Local conversations stay on this computer. You
                can use both, or set up a cloud agent later in Settings → Agents.
              </p>
              <Button size="sm" disabled={checkingRole} onClick={() => void setupCloud()}>
                {checkingRole ? 'Opening setup…' : 'Set up cloud agent'}
              </Button>
            </section>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={checkingRole}
            onClick={() => onFinish(teamId)}
          >
            Continue to Nuphos
          </Button>
        </div>
      </Modal>
    ))

  return { finish, dialog }
}
