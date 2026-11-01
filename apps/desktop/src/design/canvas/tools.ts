export type Tool = 'select' | 'hand' | 'text' | 'frame' | 'section' | 'note' | 'pen' | 'shape'

/** Single-key shortcuts, as on most canvases. */
export const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  h: 'hand',
  t: 'text',
  f: 'frame',
  s: 'section',
  n: 'note',
  p: 'pen',
  r: 'shape',
}

export const STARTER_HTML = (title: string) =>
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  html, body { margin: 0; min-height: 100%; font-family: -apple-system, BlinkMacSystemFont, Inter, system-ui, sans-serif; }
  body { display: grid; place-items: center; min-height: 100vh; color: #7e7a85; background: #fff; }
</style>
</head>
<body>
  <p>${title}</p>
</body>
</html>
`

export function isEditableTarget(target: EventTarget | null): boolean {
  return Boolean(
    (target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]'),
  )
}

/** The floating toolbar surface, shared by the tool strip and the zoom menu. */
export const FLOAT =
  'pointer-events-auto flex items-center gap-0.5 rounded-lg border border-main bg-main p-1 shadow-[0_4px_16px_rgba(0,0,0,0.18)]'
