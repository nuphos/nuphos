export type AppDialogOptions = {
  title: string
  message: string
  detail?: string
  confirmLabel?: string
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }

    return entities[character]
  })
}

/** Static, script-free document: resource names and errors are always text. */
export function appDialogHtml(options: AppDialogOptions): string {
  const cancel = options.confirmLabel ? 'Cancel' : 'OK'

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action https://nuphos-dialog.invalid; base-uri 'none'">
<title>${escapeHtml(options.title)}</title><style>
:root { color-scheme: light dark; font: 13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color: light-dark(#242428,#eeeef0); background: light-dark(#fff,#19191d); }
* { box-sizing: border-box; }
body { margin: 0; height: 100vh; display: flex; flex-direction: column; border: 1px solid light-dark(#ddd,#39393e); border-radius: 12px; overflow: hidden; }
header { padding: 20px 24px 8px; font-size: 12px; color: light-dark(#666,#aaa); -webkit-app-region: drag; }
main { padding: 8px 24px 24px; overflow: auto; flex: 1; overflow-wrap: anywhere; }
h1 { margin: 0 0 12px; font-size: 16px; line-height: 1.5; }
p { margin: 0; white-space: pre-wrap; line-height: 1.6; color: light-dark(#555,#bbb); }
footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 24px; border-top: 1px solid light-dark(#ddd,#39393e); }
form { margin: 0; }
button { border: 1px solid light-dark(#ccc,#444); border-radius: 6px; padding: 8px 16px; font: inherit; color: inherit; background: light-dark(#f6f6f7,#29292e); cursor: pointer; }
button:focus-visible { outline: 2px solid #a78bfa; outline-offset: 3px; }
button:hover { filter: brightness(1.1); }
.confirm { background: #7c3aed; border-color: #7c3aed; color: white; }
</style></head><body><header>Nuphos · ${escapeHtml(options.title)}</header>
<main><h1>${escapeHtml(options.message)}</h1><p>${escapeHtml(options.detail ?? '')}</p></main>
<footer><form action="https://nuphos-dialog.invalid/cancel"><button autofocus>${cancel}</button></form>
${options.confirmLabel ? `<form action="https://nuphos-dialog.invalid/confirm"><button class="confirm">${escapeHtml(options.confirmLabel)}</button></form>` : ''}
</footer></body></html>`
}
