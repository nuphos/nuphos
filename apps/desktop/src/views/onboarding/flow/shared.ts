import { faChartLine, faRocket, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import {
  ClipboardList,
  Eye,
  Folder,
  Globe,
  History,
  KeyRound,
  LayoutGrid,
  MessageSquare,
  ScrollText,
  Search,
  ShieldCheck,
  UserCheck,
} from 'lucide-react'

import type { AtlasTeam, TeamInvitation, UserInfo } from '../../../types'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'

// Providers named in the onboarding connect step. Onboarding never performs a
// real bind — it plays one scripted demo (AWS) so the user sees how
// connecting works before doing it for real, later, from Connectors. The union
// mirrors the real Connectors page's supported set even though the demo itself
// only ever picks 'aws'.
export type OnboardingProvider = 'aws' | 'gcp' | 'cloudflare' | 'linode' | 'hetzner'

// Which OS chrome the Slack demo stage draws (menu bar + top-right banner on
// macOS, taskbar + bottom-right toast on Windows 11). Defaults to the host
// OS; switchable at runtime via the dev hook `onboarding.platform(...)`.
export type OnboardingStagePlatform = 'mac' | 'windows'

export type OnboardingFlowProps = {
  user: UserInfo
  /** The team currently in scope (null for a brand-new user with no teams). */
  currentTeamId: string | null
  /** OS chrome for the Slack demo stage; defaults to macOS. */
  demoPlatform?: OnboardingStagePlatform
  /**
   * Which step to open on: 1 = intro/demo, 2 = create workspace, 3 = security
   * briefing, 4 = connect-cloud demo (simulated), 5 = connect Slack. Used by
   * the dev `onboarding.step(n)` jump; defaults to 1.
   */
  initialStep?: number
  /**
   * Whether the user can dismiss onboarding without finishing. True only when
   * onboarding was forced open for debugging (`window.onboarding()`); a genuine
   * new user must create a workspace before they can use the app.
   */
  dismissable: boolean
  /** Close without finishing — dev/debug escape hatch only. */
  onClose: () => void
  /** Create the first workspace (wraps atlasCreateTeam + adopts it as active). */
  onCreateWorkspace: (name: string) => Promise<AtlasTeam>
  /**
   * Pending workspace invitations offered in the workspace step as an
   * alternative to creating one. Accepting joins the team and continues the
   * flow from the security briefing.
   */
  pendingInvitations?: TeamInvitation[]
  /** Accept an invitation; resolves the joined team's id. */
  onAcceptInvitation?: (invitationId: string) => Promise<string>
  /**
   * Join a workspace advertising the user's email domain (discoverable teams
   * are fetched here, mirroring CreateOrJoinTeamView). Joining continues the
   * flow the same way accepting an invitation does.
   */
  onJoinDiscoverableTeam?: (teamId: string) => Promise<void>
  /**
   * Sign out from inside the (non-dismissable) overlay — the escape hatch for
   * "this invitation went to my other account" situations.
   */
  onLogout?: () => void
  /** Finish onboarding and land in the app on the given team (if any). */
  onFinish: (teamId: string | null) => void
}

// Onboarding is two visual acts: the intro demo, then one continuous agent
// CHAT that walks through creating a workspace and demoing a cloud connect.
export type Act = 'intro' | 'chat'
// Sub-steps within the chat conversation. `security` sits between creating the
// workspace and picking a cloud: a briefing that spells out the permission
// model (read-only by default, every change approved) so users feel safe
// granting real access instead of the most conservative role they can find.
// `integration` shows the (single) provider chip; `binding` plays the
// simulated connect demo for it — nothing real gets created;
// `slack` is the closing step — proactive-alerting pitch + the real Slack
// workspace bind.
export type ChatStep = 'workspace' | 'creating' | 'security' | 'integration' | 'binding' | 'slack'
export type SlackOutcome = 'connected' | 'skipped' | null

export const EASE_OUT = [0.22, 1, 0.36, 1] as const

// Scripted conversation reel for the demo panel: each scenario plays as a real
// agent turn — the user's request, the agent's acknowledgement (markdown), a
// sequence of low-key tool rows that tick from running → done, and a closing
// line. Purely presentational (no backend); it shows what the agent can do
// before the user has connected anything. `reply`/`result` render through the
// real MessageResponse, so light markdown (links, `code`) is fine here.
export type DemoScenario = {
  /** The headline noun for this scenario — fills "Ask your ___." on the left,
   *  kept in lock-step with the conversation playing on the right. */
  topic: string
  /** FA solid glyph shown above the headline, expressing this scenario. */
  icon: IconDefinition
  /** Tailwind text-color class for the glyph — distinct per scenario. */
  iconColor: string
  /** Tailwind bg-color class for the soft glow centered behind the glyph. */
  glow: string
  prompt: string
  reply: string
  steps: string[]
  result: string
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    topic: 'infrastructure',
    icon: faRocket,
    iconColor: 'text-zViolet-300',
    glow: 'bg-zViolet-500/30',
    prompt: 'Deploy my GitHub repo to AWS.',
    reply: "On it — I'll provision everything and ship it.",
    steps: [
      'Reading the repository',
      'Provisioning an ECS service',
      'Configuring the load balancer',
      'Issuing an HTTPS certificate',
    ],
    result: 'Done — your app is live at https://app.example.com',
  },
  {
    topic: 'incidents',
    icon: faTriangleExclamation,
    iconColor: 'text-amber-400',
    glow: 'bg-amber-400/25',
    prompt: 'Why is my pod stuck in CrashLoopBackOff?',
    reply: 'Let me dig into it.',
    steps: ['Fetching pod logs', 'Inspecting recent events', 'Checking resource limits'],
    result: 'Found it: the container was **OOMKilled**. Raise its memory limit to `512Mi`.',
  },
  {
    topic: 'dashboards',
    icon: faChartLine,
    iconColor: 'text-emerald-400',
    glow: 'bg-emerald-400/25',
    prompt: 'Set up a Grafana dashboard for my EC2 fleet.',
    reply: 'Sure — building it now.',
    steps: ['Querying CloudWatch metrics', 'Creating dashboard panels', 'Sharing the link'],
    result: 'Your **EC2 fleet** dashboard is ready in Grafana.',
  },
]

// Display names for the onboarding demo. Only 'aws' is ever offered in the
// connect step's chip (no real bind, so there's nothing to pick
// between); the rest of the union stays available to `providerLabel` in case
// a future demo scenario names another provider.
export const CONNECT_PROVIDERS: {
  id: OnboardingProvider
  name: string
}[] = [
  { id: 'aws', name: 'Amazon Web Services' },
  { id: 'gcp', name: 'Google Cloud' },
  { id: 'cloudflare', name: 'Cloudflare' },
  { id: 'linode', name: 'Akamai (Linode)' },
  { id: 'hetzner', name: 'Hetzner Cloud' },
]

export type ValuePropPoint = { icon: typeof Eye; title: string; body: string }

// What each claim means in practice, said by the agent after the user has
// engaged with it rather than listed on the card beforehand. Three per claim,
// the same shape throughout — a claim without them reads as a slogan.
export const VALUE_PROP_POINTS: ValuePropPoint[][] = [
  [
    {
      icon: Eye,
      title: 'Read-only by default',
      body: 'Nuphos reads configuration, metrics, and logs to understand your setup. It never modifies anything on its own.',
    },
    {
      icon: UserCheck,
      title: 'Every change needs your approval',
      body: 'Any action that would change your systems — deploys, restarts, config edits — is held until you explicitly approve it.',
    },
    {
      icon: KeyRound,
      title: 'You stay in control',
      body: 'Credentials are encrypted, used only for what you grant, and you can revoke them anytime.',
    },
  ],
  [
    {
      icon: Search,
      title: 'It looks before it answers',
      body: 'Resources, dashboards, and logs are read from the source directly, so what it tells you is what is actually there.',
    },
    {
      icon: ClipboardList,
      title: 'Changes arrive as a plan',
      body: 'Anything that would alter your systems is written out for you to read first — never applied and explained afterwards.',
    },
    {
      icon: ShieldCheck,
      title: 'It stops at the boundary',
      body: 'When a step needs permission it does not have, it asks for that step instead of failing quietly or working around it.',
    },
  ],
  [
    {
      icon: Folder,
      title: 'Your services, not generic ones',
      body: 'What runs where, what talks to what, and what your names mean — learned from your own systems, not assumed.',
    },
    {
      icon: History,
      title: 'Operational history sticks',
      body: 'Past incidents, deploys, and the fixes that worked are still there in the next session, and the one after that.',
    },
    {
      icon: ScrollText,
      title: 'Written down, not guessed',
      body: 'Everything it learns is stored as facts you can read, correct, or delete.',
    },
  ],
  [
    {
      icon: LayoutGrid,
      title: 'One workspace, both of you',
      body: 'Engineers and agents work in the same place, against the same context.',
    },
    {
      icon: Globe,
      title: 'No tool-switching tax',
      body: 'Terminal, cloud console, dashboard, docs — four trips become one, with nothing lost between them.',
    },
    {
      icon: MessageSquare,
      title: 'Reachable where you already are',
      body: 'Slack, Discord, and Lark reach the same agent holding the same context as the desktop app.',
    },
  ],
]

// Display handle for greetings and defaults: the first token of the user's
// name, with the domain stripped when that name is just an email address —
// "sam+1@example.com" greets as "sam+1", never the full address.
export function deriveFirstName(user: UserInfo): string {
  const first = (user.name || user.username || '').trim().split(/\s+/)[0] ?? ''

  return first.includes('@') ? first.slice(0, first.indexOf('@')) : first
}

export function deriveDefaultWorkspaceName(user: UserInfo): string {
  const first = deriveFirstName(user)

  return first ? `${first}'s Workspace` : 'My Workspace'
}

export function providerLabel(id: OnboardingProvider): string {
  return CONNECT_PROVIDERS.find((p) => p.id === id)?.name ?? id.toUpperCase()
}

// How long the points cascade takes end to end, so whatever follows can wait
// for it instead of guessing a delay that lands mid-fade.
export const POINT_STAGGER = 0.25
export const POINT_DURATION = 0.4
export const pointsCascade = (count: number) => (count - 1) * POINT_STAGGER + POINT_DURATION
