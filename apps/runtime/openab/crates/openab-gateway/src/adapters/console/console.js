'use strict';

(() => {
  const API = '/_openab/console';
  const POLL_MS = 5000;
  const $ = (id) => document.getElementById(id);
  let state = null;
  let csrf = '';
  let pollTimer = null;
  let expiryTimer = null;
  let signinEvents = null;
  let signinAttempt = null;

  const ERRORS = {
    wrong_password: 'That password is not correct.',
    rate_limited: 'Too many attempts. Wait a minute and try again.',
    password_too_short: 'Use at least 12 characters.',
    already_initialized: 'This agent was just set up from another browser. Sign in instead.',
    setup_locked: 'The setup window has closed. Restart the agent to reopen it.',
    too_many_codes: 'Too many unused pairing codes. Wait for one to expire.',
    invalid_url: 'Enter an http(s):// or ws(s):// address.',
    signin_failed: 'The sign-in did not complete. Try again.',
    signin_unsupported: 'This agent has no sign-in command.',
    tools_unsupported: 'This agent does not report its tools.',
    tools_failed: 'Could not read the tool list.',
    login_required: 'Your session ended. Sign in again.',
    csrf: 'Your session changed. Reload the page.',
    cross_origin: 'Open this page from the agent\'s own address.',
  };

  function toast(message, isError) {
    const el = $('toast');
    el.textContent = message;
    el.classList.toggle('error', Boolean(isError));
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.hidden = true; }, 4000);
  }

  async function api(method, path, body) {
    const headers = { 'content-type': 'application/json' };
    if (csrf) headers['x-csrf-token'] = csrf;
    const response = await fetch(API + path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok) {
      const code = data && data.error;
      const error = new Error(ERRORS[code] || `Request failed (${response.status})`);
      error.code = code;
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function fail(error) {
    toast(error.message, true);
    if (error.code === 'login_required') refresh();
  }

  function when(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
  }

  function show(view) {
    for (const id of ['view-loading', 'view-setup', 'view-locked', 'view-login', 'view-console']) {
      $(id).hidden = id !== view;
    }
    $('session-actions').hidden = view !== 'view-console';
  }

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function renderInitialized() {
    const node = $('initialized');
    const by = state.initializedBy;
    let text = '';
    if (by === 'deployment') text = 'Set up by its deployment key (OPENAB_ACP_AUTH_KEY); that key is also the console password until you change it.';
    else if (state.initializedAt) text = `Initialized at ${when(state.initializedAt)}`;
    if (by === 'legacy-password') text += ' (from the runtime password it had before)';
    if (state.passwordChangedAt) text += ` · password changed ${when(state.passwordChangedAt)}`;
    node.textContent = text;
    node.hidden = !text;
  }

  function bindingTitle(binding) {
    if (binding.source === 'legacy-password') return 'Connected with the runtime password (before one-click connect)';
    return binding.client.teamName || binding.label || 'Nuphos team';
  }

  function renderBindings() {
    const list = $('bindings');
    list.replaceChildren();
    const bindings = state.bindings || [];
    for (const binding of bindings) {
      const item = el('li');
      const info = el('div');
      const title = el('div', bindingTitle(binding), 'title');
      if (binding.state === 'pending') title.append(el('span', 'waiting for first use', 'badge pending'));
      info.append(title);
      const details = [];
      if (binding.client.pairedBy) details.push(`by ${binding.client.pairedBy}`);
      if (binding.client.backendOrigin) details.push(binding.client.backendOrigin);
      details.push(`connected ${when(binding.createdAt)}`);
      if (binding.lastUsedAt) details.push(`last used ${when(binding.lastUsedAt)}`);
      info.append(el('div', details.join(' · '), 'muted'));
      if (binding.source === 'legacy-password') {
        info.append(el('div', 'Reconnect from Nuphos with "Connect to Nuphos" to give that team its own key, then revoke this.', 'muted'));
      }
      const revoke = el('button', 'Revoke', 'danger');
      revoke.type = 'button';
      revoke.addEventListener('click', async () => {
        if (!window.confirm(`Revoke "${bindingTitle(binding)}"? That team loses access to this agent immediately.`)) return;
        revoke.disabled = true;
        try {
          await api('DELETE', `/bindings/${encodeURIComponent(binding.id)}`);
          toast('Revoked.');
          await refresh();
        } catch (error) {
          revoke.disabled = false;
          fail(error);
        }
      });
      item.append(info, revoke);
      list.append(item);
    }
    const keys = state.deploymentKeys || {};
    if (keys.transport || keys.control) {
      const item = el('li');
      const info = el('div');
      info.append(el('div', 'Deployment key', 'title'));
      info.append(el('div', 'Set by OPENAB_ACP_AUTH_KEY / OPENAB_ACP_CONTROL_KEY. Remove the environment variable and restart to revoke it.', 'muted'));
      item.append(info);
      list.append(item);
    }
    if (!list.children.length) list.append(el('li', 'No Nuphos team is connected yet.', 'muted'));
  }

  function renderUrl() {
    const source = state.publicUrlSource;
    const url = state.publicUrl || '';
    const local = /^wss?:\/\/(localhost|127\.|\[::1\])/.test(url);
    let text = source === 'console' ? 'Set here.' : source === 'environment' ? 'Set by OPENAB_RUNTIME_PUBLIC_URL.' : 'Detected from this page\'s address.';
    if (local) text += ' Nuphos cannot reach a localhost address unless it runs on this machine; set the address Nuphos uses to reach this agent.';
    $('url-source').textContent = `${url || 'No URL yet.'} — ${text}`;
    if (document.activeElement !== $('public-url')) $('public-url').value = source === 'console' ? url : '';
  }

  function renderProvider() {
    const provider = state.provider || {};
    const label = state.label || 'The agent';
    let text = `${label}: sign-in status unknown.`;
    if (provider.authenticated === true) text = `${label} is signed in.`;
    if (provider.authenticated === false) text = `${label} is not signed in yet. Sign in here or from Nuphos.`;
    $('provider-status').textContent = text;
    $('signin-start').hidden = !provider.signInSupported || Boolean(signinAttempt);
    if (provider.authenticated === true) $('signin-start').textContent = 'Sign in again';
  }

  function render() {
    renderInitialized();
    if (state.phase === 'setup') {
      show('view-setup');
      $('setup-window').textContent = state.setupWindowEndsAt
        ? `Setup stays open until ${when(state.setupWindowEndsAt)}.`
        : '';
      return;
    }
    if (state.phase === 'locked') return show('view-locked');
    if (state.phase === 'login') return show('view-login');
    show('view-console');
    renderBindings();
    renderUrl();
    renderProvider();
  }

  async function refresh() {
    try {
      state = await api('GET', '/state');
      csrf = state.csrfToken || '';
      if (!$('setup-generated').hidden && state.phase === 'console') return;
      render();
    } catch (error) {
      toast(error.message, true);
    }
    clearTimeout(pollTimer);
    if (state && state.phase === 'console') pollTimer = setTimeout(refresh, POLL_MS);
  }

  function copyFrom(id) {
    const text = $(id).textContent;
    navigator.clipboard.writeText(text).then(() => toast('Copied.'), () => toast('Copy failed. Select the text instead.', true));
  }

  function startExpiry(expiresAt) {
    clearInterval(expiryTimer);
    const tick = () => {
      const left = Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000);
      if (left <= 0) {
        $('pairing-expiry').textContent = 'This code has expired. Generate a new one.';
        clearInterval(expiryTimer);
        return;
      }
      $('pairing-expiry').textContent = `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}.`;
    };
    tick();
    expiryTimer = setInterval(tick, 1000);
  }

  async function connect() {
    const button = $('connect');
    button.disabled = true;
    try {
      const minted = await api('POST', '/pairing-codes');
      $('pairing').hidden = false;
      $('pairing-url').textContent = minted.url || '';
      $('pairing-code').textContent = minted.code;
      $('pairing-hint').textContent = minted.deepLink
        ? 'Nuphos Desktop should open now. If it does not, go to Settings → Agent → Connect your own in Nuphos and enter this URL and pairing code.'
        : 'In Nuphos, go to Settings → Agent → Connect your own and enter this URL and pairing code.';
      startExpiry(minted.expiresAt);
      if (minted.deepLink) window.location.href = minted.deepLink;
    } catch (error) {
      fail(error);
    } finally {
      button.disabled = false;
    }
  }

  function endSignin() {
    if (signinEvents) signinEvents.close();
    signinEvents = null;
    signinAttempt = null;
    $('signin').hidden = true;
    $('signin-input-form').hidden = true;
    $('signin-link').hidden = true;
    $('signin-device').hidden = true;
  }

  function webUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch {
      return null;
    }
  }

  function onFrame(frame) {
    const authorizeUrl = webUrl(frame.url);
    const verifyUrl = webUrl(frame.verificationUri);
    if (frame.type === 'authorize' && authorizeUrl) {
      $('signin-url').href = authorizeUrl;
      $('signin-link').hidden = false;
      $('signin-input-form').hidden = false;
      $('signin-message').textContent = 'Open the sign-in page, approve access, then paste the code it shows.';
    } else if (frame.type === 'device' && verifyUrl) {
      $('signin-code').textContent = frame.userCode || '';
      $('signin-verify').href = verifyUrl;
      $('signin-verify').textContent = verifyUrl;
      $('signin-device').hidden = false;
      $('signin-message').textContent = 'Waiting for you to approve the sign-in…';
    } else if (frame.type === 'authenticated') {
      $('signin-message').textContent = 'Signed in.';
    } else if (frame.type === 'error') {
      $('signin-message').textContent = frame.message || frame.reason || 'The sign-in failed.';
    }
  }

  async function startSignin() {
    try {
      const { attemptId } = await api('POST', '/signin/start');
      signinAttempt = attemptId;
      $('signin').hidden = false;
      $('signin-start').hidden = true;
      $('signin-message').textContent = 'Starting sign-in…';
      signinEvents = new EventSource(`${API}/signin/events?attemptId=${encodeURIComponent(attemptId)}`);
      signinEvents.addEventListener('frame', (event) => onFrame(JSON.parse(event.data)));
      signinEvents.addEventListener('result', (event) => {
        const result = JSON.parse(event.data);
        endSignin();
        if (result.ok) toast('Signed in.');
        else toast(ERRORS[result.error] || 'The sign-in did not complete.', true);
        refresh();
      });
      signinEvents.onerror = () => {
        if (signinEvents && signinEvents.readyState === EventSource.CLOSED) endSignin();
      };
    } catch (error) {
      fail(error);
    }
  }

  function bind() {
    for (const button of document.querySelectorAll('[data-copy]')) {
      button.addEventListener('click', () => copyFrom(button.dataset.copy));
    }

    $('setup-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const password = $('setup-password').value;
      if (password !== $('setup-confirm').value) return toast('The passwords do not match.', true);
      try {
        await api('POST', '/setup', { password });
        toast('Password set.');
        await refresh();
      } catch (error) {
        fail(error);
        refresh();
      }
    });

    $('setup-generate').addEventListener('click', async () => {
      try {
        const result = await api('POST', '/setup', { generate: true });
        $('setup-form').hidden = true;
        $('generated-password').textContent = result.password;
        $('setup-generated').hidden = false;
      } catch (error) {
        fail(error);
        refresh();
      }
    });

    $('setup-continue').addEventListener('click', () => {
      $('generated-password').textContent = '';
      $('setup-generated').hidden = true;
      $('setup-form').hidden = false;
      refresh();
    });

    $('login-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('POST', '/login', { password: $('login-password').value });
        $('login-password').value = '';
        await refresh();
      } catch (error) {
        fail(error);
      }
    });

    $('logout').addEventListener('click', async () => {
      try { await api('POST', '/logout'); } catch { /* the session is gone either way */ }
      csrf = '';
      endSignin();
      refresh();
    });

    $('connect').addEventListener('click', connect);

    $('url-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('POST', '/public-url', { url: $('public-url').value });
        toast('Saved.');
        refresh();
      } catch (error) {
        fail(error);
      }
    });

    $('url-reset').addEventListener('click', async () => {
      try {
        await api('POST', '/public-url', { url: null });
        $('public-url').value = '';
        refresh();
      } catch (error) {
        fail(error);
      }
    });

    $('signin-start').addEventListener('click', startSignin);

    $('signin-input-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = $('signin-input').value.trim();
      if (!text || !signinAttempt) return;
      try {
        await api('POST', '/signin/input', { attemptId: signinAttempt, text });
        $('signin-input').value = '';
        $('signin-message').textContent = 'Checking the code…';
      } catch (error) {
        fail(error);
      }
    });

    $('signin-cancel').addEventListener('click', async () => {
      if (signinAttempt) {
        try { await api('POST', '/signin/cancel', { attemptId: signinAttempt }); } catch (error) { fail(error); }
      }
      endSignin();
      refresh();
    });

    $('tools-load').addEventListener('click', async () => {
      const list = $('tools');
      list.replaceChildren(el('li', 'Loading…', 'muted'));
      try {
        const result = await api('GET', '/tools');
        list.replaceChildren();
        for (const tool of result.tools || []) {
          const item = el('li');
          const info = el('div');
          const title = el('div', tool.name, 'title');
          title.append(el('span', tool.installed ? 'installed' : 'installs on first use', tool.installed ? 'badge ok' : 'badge off'));
          info.append(title);
          if (tool.description) info.append(el('div', tool.description, 'muted'));
          item.append(info);
          list.append(item);
        }
        if (!list.children.length) list.append(el('li', 'No tools reported.', 'muted'));
      } catch (error) {
        list.replaceChildren();
        fail(error);
      }
    });

    $('password-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('POST', '/password', { current: $('password-current').value, next: $('password-next').value });
        $('password-current').value = '';
        $('password-next').value = '';
        toast('Password changed.');
      } catch (error) {
        fail(error);
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bind();
    refresh();
  });
})();
