import { RadioGroup } from '@base-ui/react/radio-group'
import { Cloud, Laptop, Loader2, Server } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../../../components/ui/button'

import { RadioCard, SetupScreen } from './SetupChrome'

export type CloudChoice = 'managed' | 'self-hosted'

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
  /** `undefined` while the workspace role is loading. */
  isAdmin: boolean | undefined
  onSkip: () => void
  onChoose: (choice: CloudChoice) => void
}) {
  const [choice, setChoice] = useState<CloudChoice>('managed')

  return (
    <SetupScreen
      title="Keep working when your computer is closed"
      subtitle="Local agents stop when this computer sleeps or Nuphos quits. A cloud agent keeps running, so you can close your laptop and pick up the conversation on your phone."
      actions={
        <>
          {isAdmin && (
            <Button variant="ghost" onClick={onSkip}>
              Skip for now
            </Button>
          )}
          <Button
            disabled={isAdmin === undefined}
            onClick={() => (isAdmin ? onChoose(choice) : onSkip())}
          >
            Continue
          </Button>
        </>
      }
    >
      <Comparison />
      <div className="space-y-3">
        <h2 className="text-[14px] font-medium text-main">Add a cloud agent</h2>
        {isAdmin === undefined && (
          <p className="flex items-center gap-2 text-[13px] text-secondary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Checking your workspace role…
          </p>
        )}
        {isAdmin === true && (
          <RadioGroup
            value={choice}
            onValueChange={(value: CloudChoice) => setChoice(value)}
            className="space-y-2"
            aria-label="Cloud agent type"
          >
            <RadioCard
              value="managed"
              selected={choice === 'managed'}
              icon={<Cloud className="h-4 w-4" />}
              title="Nuphos Cloud"
              badge="Recommended"
              description="We run and update the agent for you. Sign in with Claude, ChatGPT, xAI or Google."
            />
            <RadioCard
              value="self-hosted"
              selected={choice === 'self-hosted'}
              icon={<Server className="h-4 w-4" />}
              title="Self-hosted"
              description="Run it on your own account: Zeabur, Railway or any server with Docker Compose."
            />
          </RadioGroup>
        )}
        {isAdmin === false && (
          <p className="rounded-xl border border-zGray-800 bg-zGray-900/60 px-4 py-3 text-[13px] leading-5 text-secondary">
            Cloud agents are added by workspace admins. Ask an admin of this workspace to add one;
            it shows up for you automatically.
          </p>
        )}
      </div>
    </SetupScreen>
  )
}
