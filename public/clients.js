const form = document.querySelector('#client-link-form');
const optionsRoot = document.querySelector('#client-provider-options');
const linksRoot = document.querySelector('#client-links-root');

function flash(message, kind = 'info') {
  const banner = document.createElement('div');
  banner.className = `flash flash-${kind}`;
  banner.textContent = message;
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }
  return payload;
}

function providerSection(provider) {
  const checked = provider.id === 'facebook' ? 'checked' : '';
  return `
    <section class="asset-group">
      <div class="asset-group-header">
        <div>
          <p class="card-kicker">${provider.id}</p>
          <h3>${provider.name}</h3>
        </div>
        <label class="field-inline"><input type="checkbox" name="requestedProviders" value="${provider.id}" ${checked}> Include</label>
      </div>
      <div class="asset-list">
        <label class="asset-option"><input type="checkbox" name="${provider.id}:assetTypes" value="ad_account" checked><span><strong>Ad accounts</strong><small>Request account management approval</small></span></label>
        <label class="asset-option"><input type="checkbox" name="${provider.id}:assetTypes" value="business_manager"><span><strong>Business managers</strong><small>Request business-level admin access</small></span></label>
        <label class="asset-option"><input type="checkbox" name="${provider.id}:assetTypes" value="page"><span><strong>Pages / profiles</strong><small>Request page or profile access where relevant</small></span></label>
        <label class="field-label">Permission level<select name="${provider.id}:permissionLevel"><option value="admin">Admin</option><option value="standard">Standard</option><option value="analyst">Analyst</option></select></label>
      </div>
    </section>
  `;
}

function renderLinks(sessions) {
  linksRoot.innerHTML = sessions.length
    ? sessions.slice().reverse().map((session) => `
      <article class="asset-group">
        <div class="asset-group-header">
          <div>
            <p class="card-kicker">${session.partnerName}</p>
            <h3>${session.clientName}</h3>
          </div>
          <a class="button-link" href="${session.launchUrl}" target="_blank" rel="noreferrer">Open link</a>
        </div>
        <p class="muted">${session.clientEmail}</p>
        <code>${session.launchUrl}</code>
      </article>
    `).join('')
    : '<p class="empty-state">No client links generated yet.</p>';
}

async function load() {
  const [providersPayload, linksPayload] = await Promise.all([
    api('/api/admin/providers'),
    api('/api/admin/client-link-sessions'),
  ]);
  optionsRoot.innerHTML = providersPayload.providers.map(providerSection).join('');
  renderLinks(linksPayload.sessions || []);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const requestedProviders = data.getAll('requestedProviders');
  const requestedAccess = requestedProviders.map((providerId) => ({
    providerId,
    assetTypes: data.getAll(`${providerId}:assetTypes`),
    permissionLevel: data.get(`${providerId}:permissionLevel`) || 'admin',
  }));

  try {
    const payload = await api('/api/admin/client-link-sessions', {
      method: 'POST',
      body: JSON.stringify({
        partnerName: data.get('partnerName'),
        partnerId: data.get('partnerId'),
        clientName: data.get('clientName'),
        clientEmail: data.get('clientEmail'),
        requestedProviders,
        requestedAccess,
      }),
    });
    flash('Client link created.', 'success');
    const linksPayload = await api('/api/admin/client-link-sessions');
    renderLinks(linksPayload.sessions || []);
    window.open(payload.launchUrl, '_blank', 'noopener,noreferrer');
  } catch (error) {
    flash(error.message, 'error');
  }
});

load().catch((error) => flash(error.message, 'error'));
