import type { OpenAbProvider } from '@/lib/claude-code-preview/runtime-provider'

// A settings line as one plain English sentence, which the phone apps show as it is.

export type Setting = 'model' | 'effort' | 'fast'

/** Who a line names first: a person, a Task acting for one, the agent itself, or Nuphos. */
export type LineActor =
  | { type: 'person'; id: string; name: string; avatarURL: string }
  | { type: 'task'; sessionId: string; title: string; provider?: OpenAbProvider }
  | { type: 'runtime'; label: string; provider?: OpenAbProvider }
  | { type: 'nuphos' }
/** A value as the runtime names it. */
export type Choice = { value: string; name?: string }
/** A setting's change; an absent value is the agent's default. */
export type Shown = { setting: Setting; from?: Choice; to?: Choice }

// Effort levels as the picker shows them; a level it does not know keeps the runtime's name.
const EFFORT: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
}

/** A value as the picker shows it. */
export const label = (setting: Setting, choice?: Choice) =>
  choice &&
  ((setting === 'effort' ? EFFORT[choice.value] : undefined) ?? choice.name ?? choice.value)

const LABEL = { model: 'the model', effort: 'effort', fast: 'fast mode' }
const and = (parts: string[]) => new Intl.ListFormat('en', { type: 'conjunction' }).format(parts)
const short = (title: string) => (title.length > 40 ? `${title.slice(0, 39).trimEnd()}…` : title)

function actorName(actor: LineActor) {
  if (actor.type === 'person') return actor.name
  if (actor.type === 'task') return `${short(actor.title)} (a Task)`

  return actor.type === 'runtime' ? actor.label : 'Nuphos'
}

const fastTurned = (to?: Choice) =>
  to?.value === 'on' || to?.value === 'off' ? to.value : undefined

function changed(settings: Shown[]) {
  if (settings.length === 1) {
    const [{ setting, from, to }] = settings as [Shown]

    if (setting === 'fast' && fastTurned(to)) return `turned fast mode ${fastTurned(to)}`
    const was = label(setting, from)

    return [
      'changed',
      LABEL[setting],
      ...(was ? ['from', was] : []),
      'to',
      label(setting, to) ?? 'Default',
    ].join(' ')
  }

  return `changed ${and(
    settings.map(({ setting, to }) =>
      setting === 'fast' && fastTurned(to)
        ? `fast mode ${fastTurned(to)}`
        : `${LABEL[setting]} to ${label(setting, to) ?? 'Default'}`,
    ),
  )}`
}

/** `values`: what an agent filled in, for a `set` line. */
export function sentenceOf(
  actor: LineActor,
  form: 'set' | 'changed',
  settings: Shown[],
  values: string[],
) {
  return form === 'set'
    ? `${actorName(actor)} set ${values.join(' · ')}`
    : `${actorName(actor)} ${changed(settings)}`
}
