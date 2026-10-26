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

When a sign-in starts, only its IP decides, checked against the account's
other sessions (all from the last 30 days, the longest a session lives):

| Situation                                                   | Email |
| ----------------------------------------------------------- | ----- |
| no trusted IP (not behind Cloudflare)                       | no    |
| an earlier session used this exact IP                       | no    |
| account created within the hour, no other session (sign-up) | no    |
| anything else                                               | yes   |

City and country only describe the sign-in in the email.

The email leads with what the server saw, the time (UTC) and IP, then the
approximate location and device as hints, and says how to sign that device out
and reset the password. Sending is best effort and never blocks the sign-in.

The device name in any email is never the request's header text: `x-atlas-client`
and `User-Agent` are whatever the caller sends, and the sign-in code endpoint is
public. Emails show a known app name (`nuphos-desktop/1.2.0` → "Nuphos Desktop
1.2.0"), a browser and system from a fixed list, or "Unknown device". The raw
values stay on the session record.

The sign-in code email also says where the code was requested from.

The IP, city and country come only from Cloudflare (`CF-Connecting-IP`,
`CF-IPCity`, `CF-IPCountry`). Hosted Nuphos only accepts traffic from Cloudflare
(Authenticated Origin Pulls), so these are trustworthy there. `X-Forwarded-For`
is never used for a sign-in: any caller can set it, and the alert trusts the IP.
Off Cloudflare the IP is unknown, so sessions show no place and no alert is sent. A browser Google sign-in on
nuphos.ai is made server-to-server by the website, so its session records the
website's address rather than the browser's. Until the website passes the
visitor's address on, a web sign-in after an earlier web sign-in looks familiar
and is not reported.
