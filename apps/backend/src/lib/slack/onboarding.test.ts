// The DM confirmation has to tell the truth about what happened in the
// channel: linking succeeds even when the bot cannot post there (it holds no
// channels:join scope), and silently claiming success would leave the user
// waiting for a reply that can never come.
import { describe, expect, test } from 'bun:test'

import { buildChannelLinkedInteractionResponse } from './onboarding'

function confirmationText(announcement?: 'posted' | 'not_in_channel' | 'failed'): string {
  const response = buildChannelLinkedInteractionResponse({
    channelId: 'C123',
    channelName: 'ops',
    ...(announcement ? { announcement } : {}),
  })

  return JSON.stringify(response.blocks)
}

describe('buildChannelLinkedInteractionResponse', () => {
  test('replaces the picker card in place', () => {
    const response = buildChannelLinkedInteractionResponse({
      channelId: 'C123',
      channelName: 'ops',
      announcement: 'posted',
    })

    expect(response.replace_original).toBe(true)
  })

  test('always names the linked channel', () => {
    expect(confirmationText('posted')).toContain('#ops')
  })

  test('says it introduced itself when the intro landed', () => {
    expect(confirmationText('posted')).toContain('said hello')
  })

  test('asks for an invite when the bot is not in the channel', () => {
    const text = confirmationText('not_in_channel')

    expect(text).toContain('/invite @Nuphos')
    expect(text).not.toContain('said hello')
  })

  test('admits it when the intro could not be posted for another reason', () => {
    const text = confirmationText('failed')

    expect(text).toContain("couldn't post an intro")
  })

  test('keeps a picker so more channels can be linked', () => {
    expect(confirmationText('posted')).toContain('nuphos_link_channel')
  })
})
