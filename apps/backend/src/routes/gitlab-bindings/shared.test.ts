import { describe, expect, test } from 'bun:test'

import { gitlabFetch, normalizeHostUrl } from '@/lib/byos/gitlab/http'
import { AppError } from '@/lib/errors'

import { handleGitlabError } from './shared'

/** The API answer for a GitLab call that threw `run`'s error. */
async function answerFor(run: () => unknown): Promise<AppError> {
  try {
    try {
      await run()
    } catch (e) {
      handleGitlabError(e, 'GitLab call failed')
    }
  } catch (e) {
    return e as AppError
  }
  throw new Error('The call did not fail')
}

// #4897: a host the outbound guard refuses was answered as a GitLab outage, 502 gitlab_api_error.
describe('a GitLab host URL the outbound guard refuses', () => {
  test('is the caller’s input, answered 400 with why', async () => {
    for (const hostUrl of ['http://127.0.0.1', 'https://10.0.0.5', 'http://gitlab.local']) {
      const answer = await answerFor(() => normalizeHostUrl(hostUrl))

      expect(answer).toMatchObject({ status: 400, code: 'gitlab_host_refused' })
      expect(answer.message).toContain('not allowed')
    }
  })

  test('also when it is only refused at request time', async () => {
    const answer = await answerFor(() => gitlabFetch('http://127.0.0.1/api/v4/user', {}))

    expect(answer).toMatchObject({ status: 400, code: 'gitlab_host_refused' })
  })

  test('a malformed URL is the caller’s input too', async () => {
    for (const hostUrl of ['not a url', 'ftp://gitlab.example.com'])
      expect(await answerFor(() => normalizeHostUrl(hostUrl))).toMatchObject({
        status: 400,
        code: 'invalid_gitlab_host',
      })
  })
})
