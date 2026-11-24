import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement, useRef, useState } from 'react'

import type { ConnectCardContextValue } from './connectCardContext'
import type { DecisionAnswer as RecordedAnswer } from './decisionAnswers'
import type { DecisionAnswer } from '../../../api/agent-chat-types'
import type { DesktopPhase } from '../../../lib/desktopConnection'
import type { ReactNode } from 'react'

// The live view, as the card drives it: which stream it opened, and who holds the desktop.
const streams: { id?: string; sessionId?: string; display: number }[] = []
const holds: boolean[] = []
let phase: DesktopPhase = { kind: 'connected' }

mock.module('../../../views/useLiveDesktop', () => ({
  useLiveDesktop: (id: string | undefined, target: { sessionId?: string; display: number }) => {
    const host = useRef<HTMLDivElement>(null)
    const [holding, setHolding] = useState(false)

    streams.push({ id, sessionId: target.sessionId, display: target.display })

    return {
      host,
      phase,
      holding,
      hold: (next: boolean) => {
        holds.push(next)
        setHolding(next)
      },
      retry: () => {},
    }
  },
}))
mock.module('../MessageResponse', () => ({
  MessageResponse: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}))

const { ComputerCard } = await import('./ComputerCard')
const { CardConversationContext, ConnectCardContext } = await import('./connectCardContext')
const { DecisionAnswersContext } = await import('./decisionAnswers')

function setUpDom() {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })

  return dom
}

const desktop = { deviceId: 'box-1', display: 2, title: 'Studio Box' }

async function renderCard(recorded?: RecordedAnswer, canAct = true) {
  const dom = setUpDom()
  const { createRoot } = await import('react-dom/client')
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const answers: DecisionAnswer[] = []
  const ctx: ConnectCardContextValue = {
    send: () => true,
    answer: (answer) => {
      answers.push(answer)

      return true
    },
  }

  await act(() =>
    root.render(
      createElement(
        CardConversationContext.Provider,
        { value: { teamId: 'team', sessionId: 'chat', name: 'Avery' } },
        createElement(
          DecisionAnswersContext.Provider,
          { value: new Map(recorded ? [['call-1', recorded]] : []) },
          createElement(
            ConnectCardContext.Provider,
            { value: ctx },
            createElement(ComputerCard, {
              toolCallId: 'call-1',
              question: 'Sign in to the staging dashboard',
              body: 'Use your own account; I will continue from there.',
              desktop,
              canAct,
            }),
          ),
        ),
      ),
    ),
  )
  const button = (name: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === name) as unknown as
      HTMLButtonElement | undefined
  const click = (name: string) =>
    act(() => {
      button(name)?.click()
    })

  return { container, answers, button, click, unmount: () => act(() => root.unmount()) }
}

test('the card shows the desktop live, takes it over full screen, and hands it back with I’m done', async () => {
  streams.length = 0
  holds.length = 0
  phase = { kind: 'connected' }
  const card = await renderCard()

  // The conversation's own display, live; never a picture.
  assert.deepEqual(streams.at(-1), {
    id: streams.at(-1)?.id,
    sessionId: 'chat',
    display: 2,
  })
  assert.match(streams.at(-1)?.id ?? '', /^computer:call-1:/)
  assert.equal(card.container.querySelector('img'), null)
  assert.match(card.container.textContent ?? '', /Computer · Studio Box/)
  assert.match(card.container.textContent ?? '', /Live/)
  assert.match(card.container.textContent ?? '', /You sign in on Studio Box, Avery’s computer/)
  assert.ok(card.button('Take over') && card.button('I’m done') && card.button('Skip'))

  await card.click('Take over')
  assert.deepEqual(holds, [true])
  assert.match(card.container.textContent ?? '', /You’re in control/)
  assert.match(card.container.textContent ?? '', /hand it back to Avery\./)
  assert.ok(card.container.querySelector('.fixed'))

  // The full-screen toolbar's I'm done: back to the agent, and the card is answered.
  const toolbarDone = [...card.container.querySelectorAll('.fixed button')].find(
    (b) => b.textContent === 'I’m done',
  ) as unknown as HTMLButtonElement

  await act(() => {
    toolbarDone.click()
  })
  assert.deepEqual(holds, [true, false])
  assert.deepEqual(card.answers, [{ choices: ["I'm done"] }])
  assert.equal(card.container.querySelector('.fixed'), null)
  assert.equal(card.button('Take over'), undefined)
  await card.unmount()
})

test('Skip answers the card without taking the desktop over', async () => {
  holds.length = 0
  phase = { kind: 'connected' }
  const card = await renderCard()

  await card.click('Skip')
  assert.deepEqual(card.answers, [{ choices: ['Skip'] }])
  assert.deepEqual(holds, [])
  await card.unmount()
})

test('once handed back, the live view stays, with who handed it back and after how long over it', async () => {
  streams.length = 0
  phase = { kind: 'connected' }
  const card = await renderCard({ option: "I'm done (handed back after 3m 5s)", by: 'Sam Rivera' })

  assert.equal(streams.at(-1)?.sessionId, 'chat')
  assert.match(card.container.textContent ?? '', /Handed back by Sam Rivera after 3m 5s/)
  assert.equal(card.button('Take over'), undefined)
  assert.equal(card.button('Skip'), undefined)
  assert.doesNotMatch(card.container.textContent ?? '', /Live|You sign in/)
  await card.unmount()

  const skipped = await renderCard({ option: 'Skip', by: 'Sam Rivera' })

  assert.match(skipped.container.textContent ?? '', /Skipped\./)
  await skipped.unmount()
})

test('a Box that is offline shows the desktop’s own offline state, and nothing can be taken over', async () => {
  phase = { kind: 'stopped', reason: 'offline', message: 'Computer is offline.' }
  const card = await renderCard()

  assert.match(card.container.textContent ?? '', /Computer is offline\./)
  assert.ok(card.button('Resume'))
  assert.equal(card.button('Take over')?.disabled, true)
  await card.unmount()
})

test('a desktop handed back reads in the conversation as who took it over, and for how long', async () => {
  const dom = setUpDom()
  const { createRoot } = await import('react-dom/client')
  const { AnsweredNotice } = await import('./AnsweredNotice')
  const { AskedCardsContext } = await import('./decisionAnswers')
  const container = dom.document.createElement('div')
  const root = createRoot(container as unknown as HTMLElement)
  const asked = {
    toolCallId: 'call-1',
    input: { category: 'computer', question: 'Sign in to the staging dashboard' },
    output: { desktop },
  }

  await act(() =>
    root.render(
      createElement(
        AskedCardsContext.Provider,
        { value: new Map([['req-1', asked]]) },
        createElement(AnsweredNotice, {
          notice: {
            requestId: 'req-1',
            answeredBy: 'Sam Rivera',
            question: 'Sign in to the staging dashboard',
            options: ["I'm done", 'Skip'],
            answers: [
              {
                question: 'Sign in to the staging dashboard',
                answer: "I'm done (handed back after 1m 24s)",
              },
            ],
          },
          sentAt: '2026-11-24T10:00:00Z',
        }),
      ),
    ),
  )
  const line = container.querySelector('button')?.textContent ?? ''

  assert.match(line, /Sam Rivera took over Studio Box/)
  assert.match(line, /1m 24s/)
  assert.doesNotMatch(line, /handed back after/)
  await act(() => root.unmount())
})
