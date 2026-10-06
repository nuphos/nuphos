import { ipcRenderer } from 'electron'

import type {
  GithubMergeMethod,
  GithubPullRef,
  GithubReviewEvent,
} from '../../src/types/github-pr-detail.ts'

export const githubCliApi = {
  githubCliViewer: () => ipcRenderer.invoke('github-cli:viewer'),
  githubCliComment: (pull: GithubPullRef, body: string) =>
    ipcRenderer.invoke('github-cli:comment', pull, body),
  githubCliReview: (pull: GithubPullRef, event: GithubReviewEvent, body: string) =>
    ipcRenderer.invoke('github-cli:review', pull, event, body),
  githubCliMerge: (pull: GithubPullRef, method: GithubMergeMethod, headSha: string) =>
    ipcRenderer.invoke('github-cli:merge', pull, method, headSha),
}
