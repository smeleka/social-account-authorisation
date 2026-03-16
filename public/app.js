const initialSession = window.__SESSION__;
const token = initialSession.token;

const state = {
  session: initialSession,
  availableProviders: initialSession.availableProviders || [],
  busyProvider: null,
  submitting: false,
};

const els = {
  providerGrid: document.querySelector('#provider-grid'),
  assetGroups: document.querySelector('#asset-groups'),
  activityFeed: document.querySelector('#activity-feed'),
  refreshButton: document.querySelector('#refresh-button'),
  statusPill: document.querySelector('#session-status-pill'),
  requestedProviders: document.querySelector('#requested-providers'),
  grantForm: document.querySelector('#grant-form'),
  submitGrants: document.querySelector('#submit-grants'),
};

function providerLabel(providerId) {
  const mapping = {
    facebook: 'Meta Business',
    'google-ads': 'Google Ads',
    linkedin: 'LinkedIn',
    tiktok: 'TikTok Business',
  };
  return mapping[providerId] || providerId;
}

function formatDate(dateIso) {
  return new Date(dateIso).toLocaleString();
}

function qsParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function flashBanner(message, kind = 'info') {
  const banner = document.createElement('div');
  banner.className = `flash flash-${kind}`;
  banner.textContent = message;
  document.body.appendChild(banner);
  window.setTimeout(() => banner.remove(), 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || `Request failed with ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

function renderRequestedProviders() {
  els.requestedProviders.innerHTML = state.session.requestedProviders
    .map((providerId) => {
      const provider = state.availableProviders.find((item) => item.id === providerId);
      return `<span class="provider-chip ${provider?.configured ? '' : 'provider-chip-disabled'}">${providerLabel(providerId)}</span>`;
    })
    .join('');
}

function renderProviders() {
  const connectedIds = new Set(state.session.connections.map((connection) => connection.providerId));
  els.providerGrid.innerHTML = state.session.requestedProviders.map((providerId) => {
    const provider = state.availableProviders.find((item) => item.id === providerId);
    const connected = connectedIds.has(providerId);
    const available = provider?.configured || provider?.mode === 'demo';
    const status = connected
      ? 'Connected'
      : provider?.configured
        ? 'Ready to connect'
        : provider?.mode === 'demo'
          ? 'Demo mode'
          : 'Server configuration required';
    const buttonLabel = state.busyProvider === providerId ? 'Redirecting...' : connected ? 'Reconnect' : 'Connect';
    return `
      <article class="provider-card ${connected ? 'provider-card-connected' : ''} ${available ? '' : 'provider-card-disabled'}">
        <div>
          <p class="card-kicker">${providerId}</p>
          <h3>${providerLabel(providerId)}</h3>
          <p class="muted">${status}</p>
          ${provider?.mode === 'demo' ? '<p class="muted">Uses seeded sample assets locally.</p>' : ''}
          ${provider?.docs ? `<a class="inline-link" href="${provider.docs}" target="_blank" rel="noreferrer">Docs</a>` : ''}
        </div>
        <button type="button" data-provider-id="${providerId}" ${state.busyProvider === providerId || !available ? 'disabled' : ''}>${buttonLabel}</button>
      </article>
    `;
  }).join('');
}

function renderAssets() {
  const groups = state.session.connections.map((connection) => {
    const granted = new Set(state.session.grants.filter((grant) => grant.providerId === connection.providerId).map((grant) => grant.assetId));
    const assets = connection.assets.map((asset) => {
      const checked = granted.has(asset.id) ? 'checked' : '';
      return `
        <label class="asset-option">
          <input type="checkbox" name="asset" value="${asset.id}" data-provider-id="${connection.providerId}" data-asset-name="${asset.name}" data-asset-type="${asset.type}" ${checked}>
          <span>
            <strong>${asset.name}</strong>
            <small>${asset.type.replace(/_/g, ' ')}</small>
          </span>
        </label>
      `;
    }).join('');

    return `
      <section class="asset-group">
        <div class="asset-group-header">
          <div>
            <p class="card-kicker">Connected provider</p>
            <h3>${connection.providerName}</h3>
          </div>
          <span class="muted">${connection.assets.length} assets</span>
        </div>
        <div class="asset-list">${assets}</div>
      </section>
    `;
  }).join('');

  els.assetGroups.innerHTML = groups || '<p class="empty-state">Connect at least one provider to review available ad accounts and pages.</p>';
}

function renderActivity() {
  const connectionItems = state.session.connections.map((connection) => `
    <div class="feed-item">
      <strong>${connection.providerName}</strong>
      <span>Connected ${formatDate(connection.connectedAt)}</span>
      ${connection.discoveryWarning ? `<span>${connection.discoveryWarning}</span>` : ''}
      <code>${connection.accessTokenPreview}</code>
    </div>
  `).join('');

  const grantItems = state.session.grants.map((grant) => `
    <div class="feed-item">
      <strong>${grant.assetName}</strong>
      <span>${grant.permissionLevel} access approved</span>
      <code>${grant.providerId}</code>
    </div>
  `).join('');

  els.activityFeed.innerHTML = connectionItems || grantItems
    ? `${connectionItems}${grantItems}`
    : '<p class="empty-state">No connected providers yet.</p>';
}

function render() {
  els.statusPill.textContent = state.session.status;
  renderRequestedProviders();
  renderProviders();
  renderAssets();
  renderActivity();
  els.submitGrants.disabled = state.submitting || state.session.connections.length === 0;
}

async function refreshSession() {
  state.session = await api(`/api/link-sessions/${token}`);
  state.availableProviders = state.session.availableProviders || state.availableProviders;
  render();
}

async function connectProvider(providerId) {
  state.busyProvider = providerId;
  render();
  try {
    const payload = await api(`/api/link-sessions/${token}/connections`, {
      method: 'POST',
      body: JSON.stringify({ providerId }),
    });
    window.location.assign(payload.authorizationUrl);
  } catch (error) {
    state.busyProvider = null;
    render();
    flashBanner(error.message, 'error');
  }
}

async function submitGrants(event) {
  event.preventDefault();
  const selected = [...document.querySelectorAll('input[name="asset"]:checked')].map((input) => ({
    providerId: input.dataset.providerId,
    assetId: input.value,
    assetName: input.dataset.assetName,
    assetType: input.dataset.assetType,
    permissionLevel: 'admin',
  }));

  if (selected.length === 0) {
    flashBanner('Select at least one asset before approving access.', 'error');
    return;
  }

  state.submitting = true;
  render();
  try {
    await api(`/api/link-sessions/${token}/grants`, {
      method: 'POST',
      body: JSON.stringify({ grants: selected }),
    });
    await refreshSession();
    flashBanner('Access approved and stored for the partner.', 'success');
  } catch (error) {
    flashBanner(error.message, 'error');
  } finally {
    state.submitting = false;
    render();
  }
}

els.providerGrid.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-provider-id]');
  if (!button) {
    return;
  }
  connectProvider(button.dataset.providerId);
});

els.refreshButton.addEventListener('click', refreshSession);
els.grantForm.addEventListener('submit', submitGrants);

if (qsParam('connected')) {
  flashBanner(`${providerLabel(qsParam('connected'))} connected. Choose assets to approve.`, 'success');
  window.history.replaceState({}, '', window.location.pathname);
}

if (qsParam('error')) {
  flashBanner(qsParam('error'), 'error');
  window.history.replaceState({}, '', window.location.pathname);
}

render();
