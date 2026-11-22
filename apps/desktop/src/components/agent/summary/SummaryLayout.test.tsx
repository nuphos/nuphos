import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, useState } from 'react'

const dom = new Window()
const browser: Record<string, unknown> = {
  window: dom,
  navigator: dom.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
}

for (const key of Object.getOwnPropertyNames(dom))
  if (!(key in globalThis)) browser[key] = Reflect.get(dom, key)
for (const [key, value] of Object.entries(browser))
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  })
const { createRoot } = await import('react-dom/client')

const { SummaryLayout } = await import('./SummaryLayout')

test('collapse and ordering survive remount, missing sections and corrupt storage', async () => {
  const container = document.createElement('div')
  const sections = ['a', 'b', 'c'].map((id) => ({
    id,
    title: id,
    content: <p>{id} content</p>,
  }))
  let root = createRoot(container)
  const render = () => root.render(<SummaryLayout teamId="team" sections={sections} />)

  await act(render)
  await act(() => {
    container
      .querySelector<HTMLButtonElement>('[aria-label="Drag to reorder: a"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  })
  assert.deepEqual(
    [...container.querySelectorAll('[aria-expanded]')].map((el) => el.textContent),
    ['b', 'a', 'c'],
  )
  await act(() => container.querySelector<HTMLButtonElement>('[aria-expanded]')!.click())
  assert.equal(container.querySelector('[aria-expanded]')!.getAttribute('aria-expanded'), 'false')
  await act(() =>
    root.render(<SummaryLayout teamId="team" sections={[sections[0], sections[2]]} />),
  )
  assert.deepEqual(
    [...container.querySelectorAll('[aria-expanded]')].map((el) => el.textContent),
    ['a', 'c'],
  )
  await act(render)
  assert.equal(container.querySelector('[hidden]')!.textContent, 'b content')
  await act(() => root.unmount())
  root = createRoot(container)
  await act(render)
  assert.equal(container.querySelector('[aria-expanded]')!.textContent, 'b')
  assert.equal(container.querySelector('[hidden]')!.textContent, 'b content')
  await act(() => root.render(<SummaryLayout teamId="other" key="other" sections={sections} />))
  assert.equal(container.querySelector('[hidden]'), null)
  await act(() => root.unmount())
  localStorage.setItem('chat-summary-layout:team', 'null')
  root = createRoot(container)
  await act(render)
  assert.equal(container.querySelector('[hidden]'), null)
  await act(() => root.unmount())
})

function Draft() {
  const [value, setValue] = useState('draft')

  return <button onClick={() => setValue('edited')}>{value}</button>
}

test('keyboard sorting preserves content state and unavailable section slots', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  const sections = ['a', 'b', 'c'].map((id) => ({
    id,
    title: id,
    content: <Draft />,
  }))
  const render = (visible = sections) =>
    root.render(<SummaryLayout teamId="state" sections={visible} />)
  const order = () =>
    [...container.querySelectorAll('[data-summary-section]')].map((el) =>
      el.getAttribute('data-summary-section'),
    )
  const move = (id: string, key: string) => {
    const button = container.querySelector<HTMLButtonElement>(
      `[aria-label="Drag to reorder: ${id}"]`,
    )

    assert.ok(button)
    button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  }

  await act(() => render())
  const draft = [...container.querySelectorAll('button')].find((el) => el.textContent === 'draft')

  assert.ok(draft)
  await act(() => draft.click())
  await act(() => move('a', 'ArrowUp'))
  assert.deepEqual(order(), ['a', 'b', 'c'])
  await act(() => move('c', 'ArrowDown'))
  assert.deepEqual(order(), ['a', 'b', 'c'])
  await act(() => move('a', 'ArrowDown'))
  assert.deepEqual(order(), ['b', 'a', 'c'])
  assert.ok(container.contains(draft)) // The same stateful DOM node moved.
  assert.equal(draft.textContent, 'edited')
  await act(() => render([sections[0], sections[2]]))
  await act(() => move('a', 'ArrowDown'))
  await act(() => render())
  assert.deepEqual(order(), ['b', 'c', 'a'])
  assert.equal(draft.textContent, 'edited')
  assert.equal(container.querySelector('[aria-label="Move up"]'), null)
  assert.equal(container.querySelector('[aria-label="Move down"]'), null)
  await act(() => root.unmount())
})

const { SummarySection } = await import('./ChatSummaryRows')

function HeaderActionFixture() {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('original')

  return (
    <SummarySection
      title="Instructions"
      action={!editing && <button onClick={() => setEditing(true)}>Edit fixture</button>}
    >
      {editing ? (
        <input
          aria-label="Header draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      ) : (
        <p>{draft}</p>
      )}
    </SummarySection>
  )
}

test('header actions share the handle row and preserve drafts through collapse and reorder', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)

  await act(() =>
    root.render(
      <SummaryLayout
        teamId="header-actions"
        sections={[
          {
            id: 'instructions',
            title: 'Instructions',
            content: <HeaderActionFixture />,
          },
          { id: 'other', title: 'Other', content: <p>Other</p> },
        ]}
      />,
    ),
  )
  const toggle = container.querySelector<HTMLButtonElement>('[aria-controls$="-instructions"]')!
  const handle = container.querySelector<HTMLButtonElement>(
    '[aria-label="Drag to reorder: Instructions"]',
  )!
  const edit = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Edit fixture',
  )!

  const regions = container.querySelectorAll('section[aria-label="Instructions"]')

  assert.equal(regions.length, 1)
  assert.ok(regions[0].contains(edit), 'the named region must contain its header action')
  assert.ok(regions[0].contains(handle), 'the named region must contain its drag handle')
  assert.ok(handle.parentElement?.contains(edit))
  assert.equal(edit.closest('button'), edit)
  await act(() => toggle.click())
  assert.equal(toggle.getAttribute('aria-expanded'), 'false')
  await act(() => edit.click())
  assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  const input = container.querySelector<HTMLInputElement>('[aria-label="Header draft"]')!

  await act(() => {
    input.value = 'kept draft'
    input.dispatchEvent(new dom.Event('input', { bubbles: true }))
  })
  await act(() => toggle.click())
  await act(() =>
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
  )
  await act(() => toggle.click())
  assert.equal(container.querySelector('[aria-label="Header draft"]'), input)
  assert.equal(input.value, 'kept draft')
  await act(() => root.unmount())
})
