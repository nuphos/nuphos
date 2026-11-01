import type { ArtifactClick } from '../../components/agent/artifacts/artifactSandbox'
import type { DesignFrame, DesignLink } from '../schema'

/** Spaces, case and a leading "tap / click / 點" don't decide which link a click means. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/gu, '')
    .replace(/^(?:tap|click|press|點擊|點選|點按|按下|點|按)/u, '')
}

const SHORT_TEXT = 20

function labelMatches(label: string | null | undefined, text: string): boolean {
  const l = normalize(label ?? '')
  const t = normalize(text)

  if (l.length < 2 || t.length < 2) return false

  return t.includes(l) || l.includes(t)
}

/**
 * Which screen a click inside the playing screen leads to, or null to stay.
 * A `data-goto` names the screen by id or title. A page that marks its
 * hotspots that way is taken at its word; otherwise the clicked button's
 * text is matched against the link labels, and a screen with a single way
 * out takes it from any click.
 */
export function playTarget(
  click: ArtifactClick,
  outgoing: DesignLink[],
  frames: DesignFrame[],
): string | null {
  if (click.goto) {
    const target =
      frames.find((f) => f.id === click.goto) ?? frames.find((f) => f.title === click.goto)

    return target?.id ?? null
  }
  if (click.declared) return null
  // A plain element's text is all of its children's; only a short one names a button.
  const named = click.clickable || normalize(click.text).length <= SHORT_TEXT
  const byLabel = named && outgoing.find((link) => labelMatches(link.label, click.text))

  if (byLabel) return byLabel.target
  // Generated screens often draw buttons as plain boxes, so with one way out any click takes it.
  if (outgoing.length === 1) return outgoing[0]!.target

  return null
}
