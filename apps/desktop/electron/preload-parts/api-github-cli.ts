import { ipcRenderer } from 'electron'

import type {
  GithubMergeMethod,
  GithubRefKey,
  GithubPullRef,
  GithubReviewEvent,
} from '../../src/types/github-pr-detail.ts'

export const githubCliApi = {
  githubCliViewer: () => ipcRenderer.invoke('github-cli:viewer'),
  githubCliRefSummary: (ref: GithubRefKey) => ipcRenderer.invoke('github-cli:summary', ref),
  githubCliComment: (pull: GithubPullRef, body: string) =>
    ipcRenderer.invoke('github-cli:comment', pull, body),
  githubCliReview: (pull: GithubPullRef, event: GithubReviewEvent, body: string) =>
    ipcRenderer.invoke('github-cli:review', pull, event, body),
  githubCliMerge: (pull: GithubPullRef, method: GithubMergeMethod) =>
    ipcRenderer.invoke('github-cli:merge', pull, method),
}
