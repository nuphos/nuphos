# Sign-in sessions

Every sign-in (Google, email code, password, native app redeem) starts a
server-side session. The client holds an opaque `nus_` secret; the backend
stores only its SHA-256 in `user_sessions`, with where the sign-in came from:
IP, Cloudflare's city and country for that IP, and the app's `x-atlas-client`
name. A session lapses after 14 days unused or 30 days after sign-in, and ends
at once when revoked.

- `GET /auth/sessions` lists the account's sessions (`current` marks the caller).
- `DELETE /auth/sessions/:id` ends one; `current` signs this client out.
- `DELETE /auth/sessions` signs out every other device.

These need a sign-in session. A sign-in from before sessions existed gets
`403 session_required` and should be asked to sign in again.

## New sign-in alert

When a sign-in starts, it is compared with the account's other live sessions:

| Other live sessions                                | Matching one                             | Email |
| -------------------------------------------------- | ---------------------------------------- | ----- |
| none (new account, or every earlier sign-in ended) | —                                        | no    |
| some                                               | same IP, or same app in the same country | no    |
| some                                               | none of the above                        | yes   |

The email gives the time (UTC), device, city and country, and IP, and says how
to sign that device out and reset the password. Sending is best effort and
never blocks the sign-in.

The sign-in code email also says where the code was requested from.

Location comes from Cloudflare's `CF-IPCity` / `CF-IPCountry` headers, so it is
missing on deployments not behind Cloudflare. A browser Google sign-in on
nuphos.ai is made server-to-server by the website, so its session records the
website's address rather than the browser's.
