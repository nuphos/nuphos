// CommonMark → mrkdwn conversion lives in `@/lib/slack/mrkdwn/convert` and is
// deliberately NOT re-exported here: it pulls in a markdown parser, which this
// module promises not to do (see below).
//
// Escapes the characters Slack mrkdwn treats as control sequences (&, <, >) so
// user/team-supplied text can't inject mentions, channel links, or URLs.
// Deliberately dependency-free: imported by view builders whose tests stub out
// everything that would drag in config.
export function escapeSlackMrkdwn(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
