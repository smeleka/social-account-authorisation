const root = document.querySelector('#operator-root');

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

function providerCard(provider, connection) {
  const ready = provider.configured || provider.mode === 'demo';
  const status = connection
    ? `Connected as ${connection.externalUserName || connection.externalUserId}`
    : provider.configured
      ? 'Live OAuth ready'
      : provider.mode === 'demo'
        ? 'Demo mode'
        : 'Needs system setup';

  return `
    <article class="provider-card ${connection ? 'provider-card-connected' : ''} ${ready ? '' : 'provider-card-disabled'}">
      <div>
        <p class="card-kicker">${provider.id}</p>
        <h3>${provider.name}</h3>
        <p class="muted">${status}</p>
        ${connection ? `<p class="muted">${connection.assetCount} discovered assets</p>` : ''}
        <a class="inline-link" href="${provider.docs}" target="_blank" rel="noreferrer">Docs</a>
      </div>
      <button type="button" data-provider-id="${provider.id}" ${ready ? '' : 'disabled'}>${connection ? 'Reconnect' : 'Connect my account'}</button>
    </article>
  `;
}

async function load() {
  const [providersPayload, connectionsPayload] = await Promise.all([
    api('/api/admin/providers'),
    api('/api/admin/operator-connections'),
  ]);
  const connections = new Map(connectionsPayload.connections.map((item) => [item.providerId, item]));
  root.innerHTML = `
    <div class="surface-inline-actions">
      <a class="button-link" href="/clients">Build client links</a>
    </div>
    ${providersPayload.providers.map((provider) => providerCard(provider, connections.get(provider.id))).join('')}
  `;
}

root.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-provider-id]');
  if (!button) {
    return;
  }
  button.disabled = true;
  try {
    const payload = await api('/api/admin/operator-session', {
      method: 'POST',
      body: JSON.stringify({ providerId: button.dataset.providerId }),
    });
    window.location.assign(payload.launchUrl);
  } catch (error) {
    button.disabled = false;
    flash(error.message, 'error');
  }
});

load().catch((error) => flash(error.message, 'error'));
