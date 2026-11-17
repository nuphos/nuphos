// The fixture agent's part in filling a website's form: it asks for the details in one
// secure card, then enters the saved files with local_browser `fill`. It never opens them.

/** `call`, `log` and `refused` are the fixture's own; the result handles one prompt's text. */
export function formSteps({ call, log, refused }) {
  // The site each session asked a form's details for, as `host:port`.
  const forms = new Map()

  async function ask(sessionId, site) {
    forms.set(sessionId, site)
    const message = await call(sessionId, 'request_user_decision', {
      label: 'Ask for the form details',
      category: 'credential',
      question: 'The lookup form needs these details.',
      secretName: 'E2E_LOOKUP',
      fields: [
        { name: 'E2E_ID', label: 'ID number' },
        { name: 'E2E_BIRTH', label: 'Date of birth' },
      ],
      site,
    })

    log({ sessionId, event: 'form-asked', isError: refused(message) })
  }

  /** Opens `url` in the Nuphos browser and fills the saved files into it; the result is logged as it came. */
  async function fillAt(sessionId, url, saved, event) {
    const opened = await call(sessionId, 'local_browser', { action: 'open', url })
    const tab = Number(/tab[\\"]*:\s*(\d+)/.exec(JSON.stringify(opened))?.[1])
    const message = await call(sessionId, 'local_browser', {
      action: 'fill',
      tab,
      fields: saved.map(([name, path]) => ({ selector: `#${name}`, path })),
    })

    log({ sessionId, event, isError: refused(message), detail: JSON.stringify(message.result) })
  }

  return async (sessionId, text) => {
    const site = /E2E_FORM:(\S+)/.exec(text)?.[1]

    if (site) await ask(sessionId, site)
    if (!forms.has(sessionId) || !text.includes('saved to these files')) return
    // The card's answer names one file per field.
    const saved = [...text.matchAll(/^(E2E_\w+): (\S+)$/gm)].map(([, name, path]) => [name, path])
    const asked = forms.get(sessionId)

    // The same page under another host name is another origin: tried first, then the site itself.
    await fillAt(
      sessionId,
      `http://${asked.replace('localhost', '127.0.0.1')}/`,
      saved,
      'fill-elsewhere',
    )
    await fillAt(sessionId, `http://${asked}/`, saved, 'fill')
  }
}
