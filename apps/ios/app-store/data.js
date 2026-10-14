// Sample (fictional) data shared by the fixture-driven captures and the HTML port.
exports.convs = [
  { who: 'BW', title: 'Add SSO to the admin dashboard', agent: 'claude', meta: 'Running tests… · Claude Code', state: 'working' },
  { who: 'MC', title: 'Migrate billing jobs to the queue', agent: 'codex', meta: 'Opening pull request… · Codex', state: 'working' },
  { who: 'BW', title: 'Fix the flaky checkout e2e test', agent: 'claude', meta: '9 min · MacBook Pro · Claude Code', state: 'unread' },
  { who: 'LP', title: 'Upgrade the web app to React 19', agent: 'claude', meta: '47 min · Claude Code', state: 'unread' },
  { who: 'BW', title: 'Review PR #482: rate limiter', agent: 'codex', meta: '1 hr · Codex' },
  { who: 'MC', title: 'Why is the staging build slow?', agent: 'codex', meta: '3 hrs · Codex' },
  { who: 'BW', title: 'Refactor the auth middleware', agent: 'claude', meta: '22 hrs · MacBook Pro · Claude Code' },
  { who: 'LP', title: 'Draft the v2.4 release notes', agent: 'claude', meta: '1 day · Claude Code' },
  { who: 'BW', title: 'Add dark mode to settings', agent: 'claude', meta: '2 days · Claude Code' },
];
// More rows for the taller iPad home screen.
exports.more = [
  { who: 'MC', title: 'Bump the Postgres driver', agent: 'codex', meta: '3 days · Codex' },
  { who: 'LP', title: 'Write the onboarding checklist', agent: 'claude', meta: '4 days · Claude Code' },
  { who: 'BW', title: 'Trim the Docker image size', agent: 'claude', meta: '5 days · MacBook Pro · Claude Code' },
  { who: 'MC', title: 'Add retries to the webhook sender', agent: 'codex', meta: '6 days · Codex' },
  { who: 'LP', title: 'Clean up unused feature flags', agent: 'claude', meta: '1 wk · Claude Code' },
];
