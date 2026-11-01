import { Fragment } from 'react'

export const hl = (s: string) => <span className="text-main">{s}</span>

/** Splices nodes into a translated sentence in place of its `{name}` placeholders. */
export function rich(text: string, parts: Record<string, React.ReactNode>) {
  return text.split(/(\{\w+\})/).map((seg, i) => {
    const name = /^\{(\w+)\}$/.exec(seg)?.[1]

    return <Fragment key={i}>{name && name in parts ? parts[name] : seg}</Fragment>
  })
}

// Batch scope-import payload for the console's "Batch import/export scopes"
// dialog — all tenant-level scopes the bot needs, in one paste.
export const SCOPES_IMPORT_JSON = `{
  "scopes": {
    "tenant": [
      "im:message:send_as_bot",
      "im:message.group_at_msg:readonly",
      "im:message.p2p_msg:readonly",
      "im:chat:readonly",
      "contact:contact.base:readonly"
    ],
    "user": []
  }
}`

export const SITE = { feishu: 'Feishu', larksuite: 'Lark' } as const
