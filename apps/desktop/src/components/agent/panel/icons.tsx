import { faOpenai } from '@fortawesome/free-brands-svg-icons'

import type { AgentProvider } from '../../../types/runtime'
import type { ReactElement, SVGProps } from 'react'

export function ClaudeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="#D97757"
        fillRule="nonzero"
        d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"
      />
    </svg>
  )
}

export const ClaudeCodeIcon = ClaudeIcon

export function CodexIcon(props: SVGProps<SVGSVGElement>) {
  const [width, height, , , path] = faOpenai.icon

  return (
    <svg viewBox={`0 0 ${width} ${height}`} fill="currentColor" aria-hidden="true" {...props}>
      <path d={Array.isArray(path) ? path.join(' ') : path} />
    </svg>
  )
}

export function GrokIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M0.58392448,14.9254204 L0.8326,14.66295 C2.004465,13.42985 3.1678,12.2082 2.45814,10.48105 C1.50813,8.1701 2.061355,5.4619 3.820575,3.70057 C5.6495,1.8709 8.3431,1.40957 10.59295,2.336505 C11.0907,2.52161 11.5245,2.785025 11.86295,3.02993 L9.98425,3.89849 C8.235,3.163775 6.23115,3.66355 5.0081,4.88809 C3.354105,6.5426 3.019895,9.4117 4.95835,11.2656 L-0.335,15.99995 C-0.066496,15.62975 0.2538896,15.275934 0.58392448,14.9254204 Z M14.0391,2.288155 L16.33165,2.57749377e-12 L16.20795,0.172288 C14.4658,2.574355 13.6153,3.749045 14.29795,6.6879 C14.76445,8.68415 14.261,10.90255 12.63545,12.53005 C10.5861,14.58325 7.3066,15.0403 4.6059,13.19215 L6.48885,12.3193 C8.2125,12.99705 10.0983,12.69945 11.4536,11.34255 C12.80895,9.9856 13.1133,8.00925 12.4321,6.3647 C12.30265,6.05285 11.9144,5.97455 11.64275,6.1753 L6.102,10.27035 L14.0391,2.288155 Z" />
    </svg>
  )
}

export function AntigravityIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M14.1452 14.6818C14.9937 15.3182 16.2664 14.894 15.0997 13.7273C11.5998 10.3333 12.3421 1 7.99366 1C3.64518 1 4.3876 10.3333 0.887603 13.7273C-0.385123 15 0.993664 15.3182 1.84215 14.6818C5.13002 12.4545 4.9179 8.5303 7.99366 8.5303C11.0694 8.5303 10.8573 12.4545 14.1452 14.6818Z" />
    </svg>
  )
}

export function OpenCodeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="96 96 320 320" fill="currentColor" aria-hidden="true" {...props}>
      <path opacity="0.4" d="M320 224V352H192V224H320Z" />
      <path fillRule="evenodd" d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z" />
    </svg>
  )
}

const PROVIDER_ICON: Record<AgentProvider, (props: SVGProps<SVGSVGElement>) => ReactElement> = {
  'claude-code': ClaudeIcon,
  codex: CodexIcon,
  grok: GrokIcon,
  antigravity: AntigravityIcon,
  opencode: OpenCodeIcon,
}

/** The agent's mark; Claude Code's when the provider is unknown, as for legacy records. */
export function AgentProviderIcon({
  provider,
  ...props
}: SVGProps<SVGSVGElement> & { provider: AgentProvider | null | undefined }) {
  const Icon = PROVIDER_ICON[provider ?? 'claude-code']

  return <Icon {...props} />
}
