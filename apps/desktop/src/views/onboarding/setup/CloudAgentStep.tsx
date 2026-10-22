import { RadioGroup } from '@base-ui/react/radio-group'
import { Box, Cloud, Laptop, Server } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../../../components/ui/button'
import { useBoxAvailable } from '../../settings/useAgentDevices'

import { RadioCard, SetupScreen } from './SetupChrome'

export type CloudChoice = 'box' | 'self-hosted'

function Comparison() {
  const columns = [
    {
      icon: <Laptop className="h-4 w-4" />,
      title: 'On this computer',
      points: ['Stops when your computer sleeps', 'Only reachable from this computer'],
      tone: 'text-tertiary',
    },
    {
      icon: <Cloud className="h-4 w-4" />,
      title: 'In the cloud',
      points: ['Always on, even with the lid closed', 'Continue from your phone'],
      tone: 'text-success',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3">
      {columns.map((column) => (
        <div
          key={column.title}
          className="space-y-2 rounded-xl border border-zGray-800 bg-zGray-900/60 px-4 py-3"
        >
          <p className="flex items-center gap-2 text-[13px] font-medium text-main">
            {column.icon}
            {column.title}
          </p>
          <ul className={`space-y-1 text-[12.5px] ${column.tone}`}>
            {column.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** Step 2: why a cloud agent, then which kind — or, for non-admins, who adds one. */
export function CloudAgentStep({
  isAdmin,
  onSkip,
  onChoose,
}: {
  isAdmin: boolean
  onSkip: () => void
  onChoose: (choice: CloudChoice) => void
}) {
  const boxAvailable = useBoxAvailable()
  const [picked, setChoice] = useState<CloudChoice>('box')
  // Without Boxes on this backend, your own server is the way to a cloud agent.
  const choice = boxAvailable ? picked : 'self-hosted'

  return (
    <SetupScreen
      title="Keep working when your computer is closed"
      subtitle="Local runtimes stop when this computer sleeps or Nuphos quits. A cloud runtime keeps running, so you can close your laptop and pick up where your agents left off on your phone."
      actions={
        <>
          {isAdmin && (
            <Button variant="ghost" onClick={onSkip}>
              Skip for now
            </Button>
          )}
          <Button onClick={() => (isAdmin ? onChoose(choice) : onSkip())}>Continue</Button>
        </>
      }
    >
      <Comparison />
      <div className="space-y-3">
        <h2 className="text-[14px] font-medium text-main">Add a cloud runtime</h2>
        {isAdmin && (
          <RadioGroup
            value={choice}
            onValueChange={(value: CloudChoice) => setChoice(value)}
            className="space-y-2"
            aria-label="Cloud runtime type"
          >
            {boxAvailable && (
              <RadioCard
                value="box"
                selected={choice === 'box'}
                icon={<Box className="h-4 w-4" />}
                title="New computer"
                badge="Recommended"
                description="A cloud computer Nuphos runs for you, with Claude Code and Codex. Sign in with your own account."
              />
            )}
            <RadioCard
              value="self-hosted"
              selected={choice === 'self-hosted'}
              icon={<Server className="h-4 w-4" />}
              title="Self-hosted"
              description="Run it on your own account: Zeabur, Railway or any server with Docker Compose."
            />
          </RadioGroup>
        )}
        {!isAdmin && (
          <p className="rounded-xl border border-zGray-800 bg-zGray-900/60 px-4 py-3 text-[13px] leading-5 text-secondary">
            Cloud runtimes are added by workspace admins. Ask an admin of this workspace to add one;
            it shows up for you automatically.
          </p>
        )}
      </div>
    </SetupScreen>
  )
}
