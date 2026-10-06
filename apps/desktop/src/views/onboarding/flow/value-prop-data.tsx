import { Brain, LayoutGrid, ListChecks, ShieldCheck } from 'lucide-react'

import type { StreamSegment } from './stream'

// The four value propositions — Nuphos's own pillars, in its own words
// (nuphos.ai: Trust · Action · Memory · Experience). Each one leads with the
// claim PLAYING rather than described, then names it: heading and body. The
// demo carries the weight — Trust's guarantees arrive afterwards, as the
// agent's answer to the call the user makes on it.
//
// Trust comes first because it defuses "what will this thing do to my
// account?" right before we ask for cloud access; its demo (ApprovalGate) is
// the product's real, signature interaction — the user actually approves or
// denies the write action, rather than watching it happen — and carries the
// whole claim: who is asking (role: sre-agent), under what conditions (env,
// change window), held for approval, and logged afterwards either way.
//
// Each claim is its own screen in the conversation (see ValuePropsBriefing):
// a canned reply advances to the next one, and the last hands off via onAck
// (creators move on to the connect-cloud demo, joiners finish there instead).
// The reply for each screen only appears once that screen's demo has made
// its point — Trust's real decision, or (claims 2-4) the looping demo's
// first full pass — never on a timer alone. `skipReveal` renders the active
// card statically (a dev step jump mounts straight past this step, at the
// last claim, so nothing replays).
export const VALUE_PROP_META: {
  icon: typeof ShieldCheck
  title: string
  body: string
}[] = [
  {
    icon: ShieldCheck,
    title: 'Trust',
    body: 'Control whose agent can do what, under what conditions, with approval and auditability built in.',
  },
  {
    icon: ListChecks,
    title: 'Action',
    body: 'Let agents inspect resources, open dashboards, read logs, generate plans, request approval, and take safe actions.',
  },
  {
    icon: Brain,
    title: 'Memory',
    body: 'Every team works differently. Nuphos helps agents learn your services, environments, workflows, and history.',
  },
  {
    icon: LayoutGrid,
    title: 'Experience',
    body: 'Engineers and agents work in the same workspace instead of jumping between terminals, consoles, dashboards, and docs.',
  },
]

// The scripted exchange for each of the four claims: the agent's line (which,
// after the first, affirms whatever the user just asked and then names this
// claim) and the canned reply that answers it. That reply becomes the next
// screen's opening user bubble, so only three replies live here — the fourth
// claim's reply is the exit itself (`ackLabel`, supplied by the caller), not
// a question.
export const VALUE_PROP_AGENT_LINES: StreamSegment[][] = [
  [
    { text: 'Trust', className: 'font-medium text-main' },
    ' comes first: every action is bounded by a role you control, held for your approval, and logged.',
  ],
  [
    'Inside those bounds, ',
    { text: 'Action', className: 'font-medium text-main' },
    ' is Nuphos doing the real work: inspecting resources, reading logs, drafting a plan, and asking when it needs you.',
  ],
  [
    { text: 'Memory', className: 'font-medium text-main' },
    ' is the third: it learns your services, environments, and history as it goes, so it never asks twice.',
  ],
  [
    'And the last one — ',
    { text: 'Experience', className: 'font-medium text-main' },
    ': engineers and agents share one workspace instead of jumping between terminals, consoles, and dashboards.',
  ],
]

// The canned reply that closes each screen and opens the next one as the
// user's own message. Claim 1 has none: the user's turn there is the approval
// itself, and the agent's answer to it flows straight into claim 2.
export const VALUE_PROP_REPLIES: (string | null)[] = [
  null,
  'How does it know where to look?',
  'Where does all that live?',
  'So this is where the work actually happens?',
]

// The agent's answer to that reply, said on the same screen. The reply reacts
// to the claim the user is looking at; the ANSWER is what carries them to the
// next one. The other way round — asking about the next claim on this claim's
// screen — reads as a script changing the subject rather than a reply.
export const VALUE_PROP_REPLY_ANSWERS: (StreamSegment[] | null)[] = [
  null,
  ["It isn't guessing — it already learned your setup. That's the next one."],
  [
    "In the workspace you're already in — the same place you and the agent both work. That's the last of the four.",
  ],
  ['Yes — you and the agent in the same place, working off the same context. That is the four.'],
]

// The user's call on the Trust claim's write action (see ApprovalGate below)
// — null until they act.
export type ApprovalDecision = 'approved' | 'denied'
