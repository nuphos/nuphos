// Composes the App Store screenshots (1320×2868): headline, landing-page hero frame, the ported
// screen in a phone, and app elements lifted out of it. Runs on macOS with system Chrome, which
// provides SF Pro and Georgia.
import { createRequire } from 'module'; import fs from 'fs';
import { chromium } from 'playwright-core';
const require = createRequire(import.meta.url);
const ui = require('./ui.js'), data = require('./data.js');
const { sym, mark, uri } = ui;

const CSS = `${ui.CSS}
body { width: 1320px; height: 2868px; overflow: hidden; position: relative; background: #18181A; color: #fff; font-family: -apple-system, "SF Pro Text", sans-serif; }
.bg { position: absolute; inset: 0; background-size: cover; background-position: center; }
.bg::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10,8,16,.10) 0%, rgba(10,8,16,0) 30%, rgba(10,8,16,.35) 100%); }
.copy { position: absolute; left: 0; right: 0; top: 150px; text-align: center; }
.copy h1 { font-family: "Season Serif", Georgia, "Times New Roman", serif; font-weight: 400; font-size: 112px; line-height: 1.08; letter-spacing: -.035em; white-space: nowrap; }
.copy p { margin: 34px auto 0; max-width: 1040px; font-size: 44px; line-height: 1.36; color: rgba(255,255,255,.74); letter-spacing: -.4px; text-wrap: balance; }
.phone { position: absolute; left: 202px; width: 916px; height: 1948px; border-radius: 142px; background: #050506; padding: 18px;
  box-shadow: 0 0 0 2px #3A3A40, 0 0 0 5px #17171A, 0 60px 140px rgba(0,0,0,.6); }
.screen { width: 880px; height: 1912px; border-radius: 124px; overflow: hidden; }
.screen .ios { zoom: 2; }
.tile { position: absolute; border-radius: 40px; background: rgba(30,26,42,.78); box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.14), 0 30px 80px rgba(0,0,0,.5); backdrop-filter: blur(24px); }
`;

const phone = (top, screen, left = 202) => `<div class="phone" style="top:${top}px;left:${left}px"><div class="screen">${screen}</div></div>`;
// Label in a side column, sitting on a leader that ends in a dot at the phone edge (canvas y).
const T = 760;
const X = (pt) => 220 + pt * 2, Y = (pt) => T + 18 + pt * 2; // screen point → canvas px (phone at left 202)
const FONT = 'font-family:-apple-system,"SF Pro Text",sans-serif;-webkit-font-smoothing:antialiased;color:#fff;';
const SHADOW = 'box-shadow:0 30px 70px rgba(0,0,0,.6), inset 0 0 0 .5px rgba(255,255,255,.14);';
// App elements lifted out of the screen: same markup and metrics as ui.js, enlarged and tilted.
const pop = (x, y, deg, zoom, inner) => `<div style="position:absolute;left:${x}px;top:${y}px;transform:rotate(${deg}deg);transform-origin:50% 50%"><div style="zoom:${zoom};${FONT}">${inner}</div></div>`;
const popBubble = (x, y, deg, text, who, name, zoom = 2.7) => pop(x, y, deg, zoom, `
  <div style="position:relative;display:inline-block;background:#2A2A2E;border-radius:22px;padding:10.4px 16px 8.8px;font-size:17px;line-height:24.33px;letter-spacing:-.43px;white-space:nowrap;${SHADOW}">${text}
    ${who ? `<div class="avatar f-${who}" style="position:absolute;right:-14px;top:-20px;width:36px;height:36px;font-size:13px;box-shadow:0 0 0 2.5px #141414, 0 8px 20px rgba(0,0,0,.5)">${who}</div>
    <div style="position:absolute;right:28px;top:-19px;font-size:12px;line-height:14px;font-weight:600;background:#141414;border-radius:8px;padding:3px 8px;box-shadow:inset 0 0 0 .5px rgba(255,255,255,.14)">${name}</div>` : ''}</div>`);
const SPIN = `<span style="position:relative;display:inline-block;width:20px;height:20px;flex:none">${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<b style="position:absolute;left:9px;top:1.5px;width:2px;height:5.4px;border-radius:1px;background:#C8C8CE;transform-origin:1px 8.5px;transform:rotate(${i * 45}deg);opacity:${[1, 0.3, 0.38, 0.46, 0.55, 0.65, 0.76, 0.88][i]}"></b>`).join('')}</span>`;
const popRow = (x, y, deg, c) => pop(x, y, deg, 2.3, `
  <div style="width:426px;height:75px;display:flex;align-items:center;gap:12px;padding:0 18px 0 16px;background:#202024;border-radius:22px;${SHADOW}">
    <div class="avatar f-${c.who}" style="width:36px;height:36px;font-size:13px">${c.who}</div>
    <div style="flex:1;min-width:0"><div style="font-size:17px;font-weight:500;letter-spacing:-.43px;white-space:nowrap">${c.title}</div>
      <div style="display:flex;align-items:center;gap:5px;margin-top:3px;font-size:13px;color:#A1A1AA;white-space:nowrap">${mark[c.agent](12, '#A1A1AA')}<span>${c.meta}</span></div></div>${SPIN}</div>`);
const popCard = (x, y, deg, icon, title, sub, tail = '') => pop(x, y, deg, 2.3, `
  <div style="height:66px;display:flex;align-items:center;gap:13px;padding:0 20px 0 18px;background:#202024;border-radius:22px;white-space:nowrap;${SHADOW}">${icon}
    <div><div style="font-size:17px;font-weight:600;letter-spacing:-.43px">${title}</div><div style="font-size:13px;color:#A1A1AA;margin-top:2px">${sub}</div></div>${tail}</div>`);

const shots = {
  '01-workspace': { bg: 8, h1: 'The agent workspace<br>for your team.', p: 'Claude Code and Codex in one shared workspace, with every teammate’s sessions in your pocket.',
    body: `${phone(T, ui.home(data.convs))}
      ${popRow(236, 984, -1.4, data.convs[0])}
      ${popRow(60, 1158, 1.2, data.convs[1])}` },
  '02-keep-going': { bg: 5, h1: 'Close the lid.<br>Keep the work moving.', p: 'Sessions run in the cloud, not on your laptop. Check in from your phone.',
    body: `${phone(T, ui.chatSSO(true))}
      ${popBubble(X(78.3) - 36, Y(152.7) - 40, 1.8, 'Add SSO to the admin dashboard. I’m<br>heading out, so keep going and I’ll check<br>in from my phone.', 'BW', 'Bruce')}
      ${popCard(64, Y(690), -2, sym('laptopcomputer', 'regular', 26, '#8E8E93'), 'MacBook Pro', 'Lid closed', `<span style="margin-left:14px">${sym('moon.zzz.fill', 'regular', 20, '#8E8E93')}</span>`)}
      ${popCard(520, Y(600), 1.6, sym('cloud.fill', 'regular', 26, '#A469FF'), 'Still running in the cloud', 'Running tests…', `<span style="margin-left:18px;display:flex">${SPIN}</span>`)}` },
  '03-room': { bg: 2, h1: 'A room for you<br>and your teammates.', p: 'Invite people into a running session and steer the same agent together.',
    body: `${phone(T, ui.chatBilling(true))}
      ${popBubble(X(71.5) - 60, Y(152.7) - 40, 1.6, 'Move the nightly invoice job onto the new<br>queue, and keep the cron as a fallback for<br>now.', 'MC', 'Maya')}
      ${popBubble(X(79) - 40, Y(416.5) - 34, -1.4, 'Make the tasks idempotent. A retry must<br>never invoice an account twice.', 'BW', 'Bruce')}
      ${popBubble(X(71.5) - 60, Y(656) - 26, 1.2, 'Looks good. Open the PR and I’ll review it.', 'LP', 'Leo')}` },
  '04-agents': { bg: 14, h1: 'Your agents.<br>Your subscriptions.', p: 'Use the Claude Code or Codex plan you already pay for. No extra model charge.',
    body: `${phone(T, ui.runtimes())}
      <div class="tile" style="left:96px;top:1010px;width:640px;height:190px;transform:rotate(-3deg)"></div>
      <div style="position:absolute;left:96px;top:1010px;width:640px;height:190px;transform:rotate(-3deg);display:flex;align-items:center;gap:28px;padding:0 40px">
        ${mark.claude(86)}<div style="flex:1"><div style="font-size:40px;font-weight:600;letter-spacing:-.6px">Your Claude plan</div><div style="font-size:28px;color:rgba(255,255,255,.62);margin-top:6px">Signed in as you</div></div>${sym('checkmark.circle.fill', 'regular', 46, '#34C759')}</div>
      <div class="tile" style="left:584px;top:1250px;width:640px;height:190px;transform:rotate(2.5deg)"></div>
      <div style="position:absolute;left:584px;top:1250px;width:640px;height:190px;transform:rotate(2.5deg);display:flex;align-items:center;gap:28px;padding:0 40px">
        ${mark.codex(86, '#fff')}<div style="flex:1"><div style="font-size:40px;font-weight:600;letter-spacing:-.6px">Your ChatGPT plan</div><div style="font-size:28px;color:rgba(255,255,255,.62);margin-top:6px">Signed in as you</div></div>${sym('checkmark.circle.fill', 'regular', 46, '#34C759')}</div>
      <div style="position:absolute;left:330px;top:1490px;width:660px;height:76px;border-radius:38px;background:#fff;color:#18181B;display:grid;place-items:center;font-size:32px;font-weight:600;letter-spacing:-.4px;box-shadow:0 20px 60px rgba(0,0,0,.5)">No extra model charge from Nuphos</div>` },
};

const OUT = 'build/screenshots'
fs.mkdirSync('build/html', { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1320, height: 2868 }, deviceScaleFactor: 1 });
for (const [name, s] of Object.entries(shots)) {
  const html = `<!doctype html><meta charset="utf-8"><style>${CSS}</style><div class="bg" style="background-image:url('file://${ui.BUILD}/hero-${s.bg}.png')"></div>
    <div class="copy"><h1>${s.h1}</h1><p>${s.p}</p></div>${s.body}`;
  fs.writeFileSync(`build/html/${name}.html`, html);
  await p.goto(`file://${process.cwd()}/build/html/${name}.html`); await p.screenshot({ path: `${OUT}/${name}.png` });
  console.log(name);
}
await b.close();
