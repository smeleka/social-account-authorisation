const root = document.querySelector('#settings-root');

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

function input(label, name, value = '', type = 'text', placeholder = '') {
  return `
    <label class="field-label">
      ${label}
      <input name="${name}" type="${type}" value="${value || ''}" placeholder="${placeholder}">
    </label>
  `;
}

function renderProvider(provider) {
  return `
    <form class="settings-form" data-provider-id="${provider.id}">
      <div class="section-heading">
        <div>
          <p class="eyebrow">${provider.mode}</p>
          <h3>${provider.name}</h3>
        </div>
        <a class="inline-link" href="${provider.docs}" target="_blank" rel="noreferrer">Docs</a>
      </div>
      <p class="muted">${provider.configured ? 'Live OAuth enabled.' : 'Not configured yet. Save credentials below or continue using demo mode locally.'}</p>
      <div class="settings-fields">
        ${input('Client ID', 'clientId', provider.settings.clientId)}
        ${input('Client Secret', 'clientSecret', '', 'password', provider.settings.hasClientSecret ? 'Saved' : '')}
        ${input('Scopes (comma separated)', 'scopes', provider.scopes.join(','))}
        ${provider.id === 'google-ads' ? input('Developer Token', 'developerToken', provider.settings.developerToken) : ''}
        ${provider.id === 'google-ads' ? input('Login Customer ID', 'loginCustomerId', provider.settings.loginCustomerId) : ''}
        ${provider.id === 'linkedin' ? input('Asset Discovery URL', 'assetDiscoveryUrl', provider.settings.assetDiscoveryUrl, 'url') : ''}
        ${provider.id === 'tiktok' ? input('Business Auth URL', 'businessAuthUrl', provider.settings.businessAuthUrl, 'url') : ''}
        ${provider.id === 'tiktok' ? input('Business Token URL', 'businessTokenUrl', provider.settings.businessTokenUrl, 'url') : ''}
        ${provider.id === 'tiktok' ? input('Asset Discovery URL', 'assetDiscoveryUrl', provider.settings.assetDiscoveryUrl, 'url') : ''}
      </div>
      <div class="form-actions">
        <button type="submit">Save ${provider.name}</button>
      </div>
    </form>
  `;
}

function render(payload) {
  root.innerHTML = payload.providers.map(renderProvider).join('');
}

async function load() {
  const payload = await api('/api/admin/providers');
  render(payload);
}

root.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-provider-id]');
  if (!form) {
    return;
  }
  event.preventDefault();
  const data = new FormData(form);
  const body = Object.fromEntries(data.entries());
  body.providerId = form.dataset.providerId;

  if (!body.clientSecret) {
    delete body.clientSecret;
  }

  try {
    const payload = await api('/api/admin/providers', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    render(payload);
    flash('Provider settings saved.', 'success');
  } catch (error) {
    flash(error.message, 'error');
  }
});

load().catch((error) => flash(error.message, 'error'));
