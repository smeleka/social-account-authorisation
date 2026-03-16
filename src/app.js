import { config } from './config.js';
import fs from 'node:fs';
import path from 'node:path';
import { exchangeAuthorizationCode, getProvider, listProviders, createAuthorizationUrl, listProviderSettingsForAdmin, serializeConnection } from './providers/index.js';
import { clearAdminSessionCookie, createAdminSessionCookie, isAdminAuthEnabled, verifyAdminCredentials, verifyAdminRequest } from './auth/admin.js';
import { getCurrentWorkspaceId } from './lib/context.js';
import { store } from './lib/store.js';
import { addMinutes, badRequest, generateId, html, json, methodNotAllowed, notFound, nowIso, readTextBody } from './lib/utils.js';

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');

function parseUrl(request) {
  return new URL(request.url, config.baseUrl);
}

function renderLoginPage(errorMessage = '') {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${config.appName} Login</title>
    <link rel="stylesheet" href="/app.css" />
  </head>
  <body>
    <div class="page-shell">
      <main class="grid settings-grid">
        <section class="surface settings-surface">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Admin Access</p>
              <h2>Sign in to manage the auth service</h2>
            </div>
          </div>
          <form method="post" action="/login" class="asset-groups">
            <div class="settings-fields">
              <label class="field-label">Email<input type="email" name="email" /></label>
              <label class="field-label">Password<input type="password" name="password" /></label>
            </div>
            ${errorMessage ? `<p class="empty-state">${errorMessage}</p>` : ''}
            <div class="form-actions">
              <button type="submit">Sign in</button>
            </div>
          </form>
        </section>
      </main>
    </div>
  </body>
</html>`;
}

function wantsJson(request) {
  return (request.headers.accept || '').includes('application/json') || request.url.startsWith('/api/');
}

function redirectToLogin(response) {
  response.writeHead(302, {
    location: '/login',
    'cache-control': 'no-store',
  });
  response.end();
}

function requireAdmin(request, response) {
  if (!isAdminAuthEnabled()) {
    return true;
  }

  const auth = verifyAdminRequest(request);
  if (auth.ok) {
    return true;
  }

  if (wantsJson(request)) {
    json(response, 401, { error: 'Admin authentication required' });
  } else {
    redirectToLogin(response);
  }
  return false;
}

async function sessionSummary(session) {
  return {
    id: session.id,
    token: session.token,
    status: session.status,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    partnerId: session.partnerId,
    partnerName: session.partnerName,
    clientName: session.clientName,
    clientEmail: session.clientEmail,
    requestedProviders: session.requestedProviders,
    requestedAccess: session.metadata?.requestedAccess || [],
    metadata: session.metadata,
    availableProviders: await listProviders(),
    connections: session.connections.map(serializeConnection),
    grants: session.grants,
    launchUrl: `${config.baseUrl}/link/${session.token}`,
  };
}

function sessionAssets(session) {
  return session.connections.flatMap((connection) =>
    connection.assets.map((asset) => ({
      providerId: connection.providerId,
      assetId: asset.id,
      assetName: asset.name,
      assetType: asset.type,
      connectionId: connection.id,
    }))
  );
}

function sessionStatusSummary(session) {
  return {
    id: session.id,
    token: session.token,
    status: session.status,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    requestedProviders: session.requestedProviders,
    connectedProviderIds: session.connections.map((connection) => connection.providerId),
    connectionCount: session.connections.length,
    assetCount: session.connections.reduce((total, connection) => total + connection.assets.length, 0),
    grantCount: session.grants.length,
    completedAt: session.status === 'authorized' ? session.grants[0]?.grantedAt || null : null,
  };
}

async function createClientSession(input, workspaceId) {
  const required = ['partnerId', 'partnerName', 'clientName', 'clientEmail'];
  const missing = required.filter((field) => !input[field]);
  if (missing.length > 0) {
    return { error: 'Missing required fields', details: missing, status: 400 };
  }

  const requestedProviders = Array.isArray(input.requestedProviders) && input.requestedProviders.length > 0
    ? input.requestedProviders
    : ['facebook'];

  const availableProviders = await listProviders();
  const invalidProviders = requestedProviders.filter((providerId) => !availableProviders.find((provider) => provider.id === providerId));
  if (invalidProviders.length > 0) {
    return { error: 'Unsupported providers requested', details: invalidProviders, status: 400 };
  }

  const session = await store.createLinkSession({
    ...input,
    requestedProviders,
  }, workspaceId);

  return { session };
}

async function createOperatorSession(providerId, workspaceId, source = 'settings') {
  const provider = await getProvider(providerId);
  if (!provider) {
    return { error: 'Unsupported provider', status: 400 };
  }

  const session = await store.createLinkSession({
    partnerId: 'partner_operator',
    partnerName: 'Internal Operator',
    clientName: 'Operator Self Connect',
    clientEmail: 'operator@local.test',
    requestedProviders: [providerId],
    metadata: {
      source,
      mode: 'operator-self-connect',
    },
  }, workspaceId);

  return { session, provider };
}

function validateSession(session, response) {
  if (!session) {
    notFound(response, 'Link session not found');
    return false;
  }

  if (new Date(session.expiresAt) < new Date()) {
    json(response, 410, { error: 'Link session expired' });
    return false;
  }

  return true;
}

async function renderLinkPage(session) {
  const requestedAccess = (session.metadata?.requestedAccess || [])
    .map((item) => `<li>${item.providerId}: ${item.permissionLevel} access for ${item.assetTypes.join(', ')}</li>`)
    .join('');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${config.appName}</title>
    <link rel="stylesheet" href="/app.css" />
  </head>
  <body data-session-token="${session.token}">
    <div class="page-shell">
      <header class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Client Authorisation Flow</p>
          <h1>Share ad account access with ${session.partnerName}</h1>
          <p class="lede">${session.clientName}, connect your platforms, review the detected assets, and approve only the accounts you want ${session.partnerName} to manage.</p>
          <div class="hero-meta">
            <span>Session expires <strong>${session.expiresAt}</strong></span>
            <span>Status <strong id="session-status-pill">${session.status}</strong></span>
          </div>
        </div>
        <aside class="hero-panel">
          <div class="panel-label">Requested providers</div>
          <div id="requested-providers"></div>
          ${requestedAccess ? `<div class="panel-label">Requested access</div><ul class="plain-list">${requestedAccess}</ul>` : ''}
        </aside>
      </header>
      <main class="grid">
        <section class="surface">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Step 1</p>
              <h2>Connect a provider</h2>
            </div>
            <button class="ghost-button" id="refresh-button" type="button">Refresh</button>
          </div>
          <div id="provider-grid" class="provider-grid"></div>
        </section>
        <section class="surface">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Step 2</p>
              <h2>Choose accounts to grant</h2>
            </div>
          </div>
          <form id="grant-form">
            <div id="asset-groups" class="asset-groups"></div>
            <div class="form-actions">
              <button id="submit-grants" type="submit">Approve selected access</button>
            </div>
          </form>
        </section>
        <section class="surface">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Session</p>
              <h2>Live status</h2>
            </div>
          </div>
          <div id="activity-feed" class="activity-feed"></div>
        </section>
      </main>
    </div>
    <script>
      window.__SESSION__ = ${JSON.stringify(await sessionSummary(session))};
    </script>
    <script type="module" src="/app.js"></script>
  </body>
</html>`;
}

function renderClientsPage() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${config.appName} Client Links</title>
    <link rel="stylesheet" href="/app.css" />
  </head>
  <body>
    <div class="page-shell">
      <header class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Client Link Builder</p>
          <h1>Create client authorisation links</h1>
          <p class="lede">Choose which platforms and access types to request, then generate a shareable link that sends the client into the approval flow.</p>
        </div>
        <aside class="hero-panel">
          <div class="panel-label">Flow</div>
          <p class="muted">You connect your own operator accounts first. Then you create client-specific links from here and send them to customers for approval.</p>
        </aside>
      </header>
      <main class="grid settings-grid">
        <section class="surface settings-surface">
          <div class="section-heading">
            <div>
              <p class="eyebrow">New link</p>
              <h2>Build request</h2>
            </div>
          </div>
          <form id="client-link-form" class="asset-groups">
            <div class="settings-fields">
              <label class="field-label">Partner name<input name="partnerName" value="Acme Growth" /></label>
              <label class="field-label">Partner ID<input name="partnerId" value="partner_acme" /></label>
              <label class="field-label">Client name<input name="clientName" placeholder="Northwind" /></label>
              <label class="field-label">Client email<input name="clientEmail" type="email" placeholder="ops@northwind.test" /></label>
            </div>
            <div id="client-provider-options" class="asset-groups"></div>
            <div class="form-actions">
              <button type="submit">Generate client link</button>
            </div>
          </form>
        </section>
        <section class="surface">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Recent links</p>
              <h2>Shareable sessions</h2>
            </div>
          </div>
          <div id="client-links-root" class="asset-groups"></div>
        </section>
      </main>
    </div>
    <script type="module" src="/clients.js"></script>
  </body>
</html>`;
}

function renderHomePage() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${config.appName}</title>
    <link rel="stylesheet" href="/app.css" />
  </head>
  <body>
    <div class="page-shell">
      <header class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Authorisation Hub</p>
          <h1>Connect your own platforms, then invite clients to authorise access</h1>
          <p class="lede">This mirrors the Leadsie-style workflow: first connect your operator accounts, then send clients into the same provider approval flow so they can grant access to the assets they control.</p>
          <div class="hero-meta">
            <span>Providers <strong>Meta, Google Ads, LinkedIn, TikTok</strong></span>
            <span>Mode <strong>Local demo</strong></span>
          </div>
        </div>
        <aside class="hero-panel">
          <div class="panel-label">Recommended flow</div>
          <p class="muted">Start with your own operator connection. Once that looks right, generate or send a client authorisation link.</p>
        </aside>
      </header>
      <main class="grid">
        <section class="surface">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Start Here</p>
              <h2>Choose a flow</h2>
            </div>
          </div>
          <div class="provider-grid">
            <article class="provider-card">
              <div>
                <p class="card-kicker">Operator</p>
                <h3>Connect my platforms</h3>
                <p class="muted">Use the same provider login flow you would use in Leadsie to associate your own operator accounts with the system.</p>
              </div>
              <a class="button-link" href="/operator">Open operator flow</a>
            </article>
            <article class="provider-card">
              <div>
                <p class="card-kicker">Client</p>
                <h3>Build client links</h3>
                <p class="muted">Choose platforms and requested access, then generate the exact approval link you want to send to a client.</p>
              </div>
              <a class="button-link" href="/clients">Open builder</a>
            </article>
            <article class="provider-card">
              <div>
                <p class="card-kicker">Advanced</p>
                <h3>System setup</h3>
                <p class="muted">Only needed if you are self-hosting and want to enter provider app credentials for live OAuth.</p>
              </div>
              <a class="button-link" href="/settings">Open settings</a>
            </article>
          </div>
        </section>
      </main>
    </div>
  </body>
</html>`;
}

function renderOperatorPage() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${config.appName} Operator</title>
    <link rel="stylesheet" href="/app.css" />
  </head>
  <body>
    <div class="page-shell">
      <header class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Operator Connections</p>
          <h1>Connect your own provider accounts</h1>
          <p class="lede">This is the agency-side step. Choose a platform, log into that provider, and confirm the operator connection flow. After that, clients can authorise their own assets through the same system.</p>
        </div>
        <aside class="hero-panel">
          <div class="panel-label">If you are self-hosting</div>
          <p class="muted">If a provider has not been preconfigured yet, use demo mode locally or add the platform app credentials in <a class="inline-link" href="/settings">advanced settings</a>.</p>
        </aside>
      </header>
      <main class="grid">
        <section class="surface">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Step 1</p>
              <h2>Launch operator self-connect</h2>
            </div>
          </div>
          <div id="operator-root" class="provider-grid"></div>
        </section>
      </main>
    </div>
    <script type="module" src="/operator.js"></script>
  </body>
</html>`;
}

function renderSettingsPage() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${config.appName} Settings</title>
    <link rel="stylesheet" href="/app.css" />
  </head>
  <body>
    <div class="page-shell">
      <header class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Advanced Setup</p>
          <h1>Configure provider apps for live OAuth</h1>
          <p class="lede">Most users should start with <a class="inline-link" href="/operator">Connect my platforms</a>. This page is only for the system owner who needs to register and store the underlying OAuth app credentials used by the product.</p>
        </div>
        <aside class="hero-panel">
          <div class="panel-label">Credential model</div>
          <p class="muted">These are platform app credentials issued to our system, not the client's personal passwords. Once configured, operators and clients still log in through the provider’s own consent screens.</p>
        </aside>
      </header>
      <main class="grid settings-grid">
        <section class="surface">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Preferred Workflow</p>
              <h2>Operator-first</h2>
            </div>
          </div>
          <p class="muted">Use the operator flow to connect your own Meta, Google Ads, LinkedIn, or TikTok accounts first. Then create client links that ask them to grant access to the relevant assets.</p>
          <div class="form-actions">
            <a class="button-link" href="/operator">Open operator flow</a>
          </div>
        </section>
        <section class="surface settings-surface">
          <div class="section-heading">
            <div>
              <p class="eyebrow">System Owner</p>
              <h2>Provider app credentials</h2>
            </div>
          </div>
          <div id="settings-root" class="asset-groups"></div>
        </section>
      </main>
    </div>
    <script type="module" src="/settings.js"></script>
  </body>
</html>`;
}

function normalizeProviderSettings(providerId, body) {
  const scopes = typeof body.scopes === 'string'
    ? body.scopes.split(',').map((item) => item.trim()).filter(Boolean)
    : undefined;

  const common = {
    clientId: body.clientId || '',
    clientSecret: body.clientSecret || '',
    scopes,
  };

  if (providerId === 'google-ads') {
    return {
      ...common,
      developerToken: body.developerToken || '',
      loginCustomerId: body.loginCustomerId || '',
    };
  }

  if (providerId === 'linkedin') {
    return {
      ...common,
      assetDiscoveryUrl: body.assetDiscoveryUrl || '',
    };
  }

  if (providerId === 'tiktok') {
    return {
      ...common,
      businessAuthUrl: body.businessAuthUrl || '',
      businessTokenUrl: body.businessTokenUrl || '',
      assetDiscoveryUrl: body.assetDiscoveryUrl || '',
    };
  }

  return common;
}

async function providerSettingsResponse() {
  return {
    providers: await listProviderSettingsForAdmin(),
  };
}

function serveStaticAsset(response, assetPath, contentType) {
  const filePath = path.resolve(PUBLIC_DIR, assetPath);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
    return notFound(response);
  }

  response.writeHead(200, {
    'content-type': contentType,
    'cache-control': 'no-store',
  });
  response.end(fs.readFileSync(filePath));
}

async function handleCreateSession(request, response) {
  const body = await request.json();
  const workspaceId = await getCurrentWorkspaceId();
  const result = await createClientSession(body, workspaceId);
  if (result.error) {
    return badRequest(response, result.error, result.details);
  }

  return json(response, 201, await sessionSummary(result.session));
}

async function handleCreateConnection(request, response, token) {
  const workspaceId = await getCurrentWorkspaceId();
  const session = await store.getLinkSessionByToken(token, workspaceId);
  if (!validateSession(session, response)) {
    return;
  }

  const body = await request.json();
  const providerId = body.providerId;
  const provider = await getProvider(providerId);
  if (!provider) {
    return badRequest(response, 'Unsupported provider');
  }

  const stateId = generateId('state');
  const auth = await createAuthorizationUrl({ providerId, stateId });
  await store.createConnectionState({
    id: stateId,
    sessionToken: token,
    workspaceId,
    providerId,
    createdAt: nowIso(),
    expiresAt: addMinutes(nowIso(), 10),
  });

  await store.updateLinkSession(token, workspaceId, (draft) => {
    draft.auditLog.push({ at: nowIso(), action: 'provider_connection_started', actor: 'client', providerId });
  });

  json(response, 201, {
    state: auth.stateId,
    provider,
    authorizationUrl: auth.url,
    instructions: 'Redirect the client to authorizationUrl to continue the provider OAuth flow.',
  });
}

async function handleCreateGrant(request, response, token) {
  const workspaceId = await getCurrentWorkspaceId();
  const session = await store.getLinkSessionByToken(token, workspaceId);
  if (!validateSession(session, response)) {
    return;
  }

  const body = await request.json();
  if (!Array.isArray(body.grants) || body.grants.length === 0) {
    return badRequest(response, 'grants must be a non-empty array');
  }

  const connectedAssets = new Map();
  for (const connection of session.connections) {
    for (const asset of connection.assets) {
      connectedAssets.set(`${connection.providerId}:${asset.id}`, {
        providerId: connection.providerId,
        assetId: asset.id,
        assetName: asset.name,
        assetType: asset.type,
      });
    }
  }

  const invalidGrants = body.grants.filter((grant) => !connectedAssets.has(`${grant.providerId}:${grant.assetId}`));
  if (invalidGrants.length > 0) {
    return badRequest(response, 'All grants must reference assets discovered from connected providers', invalidGrants);
  }

  const normalizedGrants = body.grants.map((grant) => {
    const asset = connectedAssets.get(`${grant.providerId}:${grant.assetId}`);
    return {
      id: generateId('grant'),
      providerId: asset.providerId,
      assetId: asset.assetId,
      assetName: asset.assetName,
      assetType: asset.assetType,
      permissionLevel: grant.permissionLevel || 'admin',
      grantedAt: nowIso(),
    };
  });

  await store.updateLinkSession(token, workspaceId, (draft) => {
    draft.status = 'authorized';
    draft.grants = normalizedGrants;
    draft.auditLog.push({ at: nowIso(), action: 'grants_confirmed', actor: 'client', grantCount: normalizedGrants.length });
  });

  for (const grant of normalizedGrants) {
    await store.upsertGrant({
      ...grant,
      id: `${session.partnerId}_${session.id}_${grant.assetId}`,
      partnerId: session.partnerId,
      partnerName: session.partnerName,
      clientName: session.clientName,
      clientEmail: session.clientEmail,
      sessionId: session.id,
      sessionToken: session.token,
    }, workspaceId);
  }

  json(response, 201, {
    status: 'authorized',
    grantCount: normalizedGrants.length,
    grants: normalizedGrants,
  });
}

async function handleOauthCallback(response, providerId, query) {
  const stateId = query.get('state');
  const code = query.get('code');
  const error = query.get('error') || query.get('error_description');
  if (!stateId) {
    return badRequest(response, 'Missing OAuth state');
  }
  if (error) {
    const state = await store.consumeConnectionState(stateId);
    if (state) {
      await store.updateLinkSession(state.sessionToken, state.workspaceId, (draft) => {
        draft.auditLog.push({ at: nowIso(), action: 'provider_connection_failed', actor: 'provider', providerId, error });
      });
    }
    response.writeHead(302, {
      location: `/link/${state?.sessionToken || ''}?error=${encodeURIComponent(String(error))}`,
      'cache-control': 'no-store',
    });
    response.end();
    return;
  }
  if (!code) {
    return badRequest(response, 'Missing OAuth code');
  }

  const state = await store.consumeConnectionState(stateId);
  if (!state) {
    return badRequest(response, 'Unknown or expired state');
  }
  if (new Date(state.expiresAt) < new Date()) {
    return badRequest(response, 'Expired OAuth state');
  }

  const session = await store.getLinkSessionByToken(state.sessionToken, state.workspaceId);
  if (!validateSession(session, response)) {
    return;
  }

  let tokens;
  try {
    tokens = await exchangeAuthorizationCode({ providerId, code });
  } catch (exchangeError) {
    await store.updateLinkSession(state.sessionToken, state.workspaceId, (draft) => {
      draft.auditLog.push({
        at: nowIso(),
        action: 'provider_connection_failed',
        actor: 'provider',
        providerId,
        error: exchangeError.message,
      });
    });
    response.writeHead(302, {
      location: `/link/${state.sessionToken}?error=${encodeURIComponent(exchangeError.message)}`,
      'cache-control': 'no-store',
    });
    response.end();
    return;
  }
  const connection = {
    id: generateId('conn'),
    providerId,
    ...tokens,
  };

  await store.updateLinkSession(state.sessionToken, state.workspaceId, (draft) => {
    draft.status = 'connected';
    draft.connections = draft.connections.filter((item) => item.providerId !== providerId);
    draft.connections.push(connection);
    draft.auditLog.push({ at: nowIso(), action: 'provider_connected', actor: 'provider', providerId, assetCount: connection.assets.length });
  });

  if (session.metadata?.mode === 'operator-self-connect') {
    const provider = await getProvider(providerId);
    await store.upsertOperatorConnection({
      providerId,
      providerName: provider?.name || providerId,
      externalUserId: connection.externalUserId,
      externalUserName: connection.externalUserName || null,
      connectedAt: connection.connectedAt,
      assetCount: connection.assets.length,
      lastSessionToken: state.sessionToken,
      mode: provider?.mode || 'demo',
    }, state.workspaceId);
  }

  response.writeHead(302, {
    location: `/link/${state.sessionToken}?connected=${encodeURIComponent(providerId)}`,
    'cache-control': 'no-store',
  });
  response.end();
}

export async function route(request, response) {
  request.json = () => request.bodyPromise || (request.bodyPromise = requestBody(request));
  const url = parseUrl(request);
  const pathname = url.pathname;

  if (pathname === '/login') {
    if (request.method === 'GET') {
      if (verifyAdminRequest(request).ok) {
        response.writeHead(302, {
          location: '/operator',
          'cache-control': 'no-store',
        });
        response.end();
        return;
      }
      return html(response, 200, renderLoginPage());
    }

    if (request.method === 'POST') {
      const body = await readTextBody(request);
      const params = new URLSearchParams(body);
      const email = params.get('email') || '';
      const password = params.get('password') || '';
      if (!verifyAdminCredentials(email, password)) {
        return html(response, 401, renderLoginPage('Invalid admin credentials.'));
      }

      response.writeHead(302, {
        location: '/operator',
        'cache-control': 'no-store',
        'set-cookie': createAdminSessionCookie(),
      });
      response.end();
      return;
    }

    return methodNotAllowed(response, ['GET', 'POST']);
  }

  if (pathname === '/logout') {
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET']);
    }
    response.writeHead(302, {
      location: '/login',
      'cache-control': 'no-store',
      'set-cookie': clearAdminSessionCookie(),
    });
    response.end();
    return;
  }

  if (pathname === '/') {
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET']);
    }
    return html(response, 200, renderHomePage());
  }

  if (pathname === '/settings') {
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET']);
    }
    if (!requireAdmin(request, response)) {
      return;
    }
    return html(response, 200, renderSettingsPage());
  }

  if (pathname === '/operator') {
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET']);
    }
    if (!requireAdmin(request, response)) {
      return;
    }
    return html(response, 200, renderOperatorPage());
  }

  if (pathname === '/clients') {
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET']);
    }
    if (!requireAdmin(request, response)) {
      return;
    }
    return html(response, 200, renderClientsPage());
  }

  if (pathname === '/app.js') {
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET']);
    }
    return serveStaticAsset(response, 'app.js', 'text/javascript; charset=utf-8');
  }

  if (pathname === '/app.css') {
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET']);
    }
    return serveStaticAsset(response, 'app.css', 'text/css; charset=utf-8');
  }

  if (pathname === '/settings.js') {
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET']);
    }
    return serveStaticAsset(response, 'settings.js', 'text/javascript; charset=utf-8');
  }

  if (pathname === '/operator.js') {
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET']);
    }
    return serveStaticAsset(response, 'operator.js', 'text/javascript; charset=utf-8');
  }

  if (pathname === '/clients.js') {
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET']);
    }
    return serveStaticAsset(response, 'clients.js', 'text/javascript; charset=utf-8');
  }

  if (pathname === '/health') {
    return json(response, 200, { ok: true, service: config.appName, at: nowIso() });
  }

  if (pathname === '/api/providers') {
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET']);
    }
    return json(response, 200, { providers: await listProviders() });
  }

  if (pathname === '/api/admin/providers') {
    if (!requireAdmin(request, response)) {
      return;
    }
    if (request.method === 'GET') {
      return json(response, 200, await providerSettingsResponse());
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const providerId = body.providerId;
      if (!(await getProvider(providerId))) {
        return badRequest(response, 'Unsupported provider');
      }
      const nextSettings = normalizeProviderSettings(providerId, body);
      const workspaceId = await getCurrentWorkspaceId();
      await store.updateProviderSettings(providerId, nextSettings, workspaceId);
      return json(response, 200, await providerSettingsResponse());
    }

    return methodNotAllowed(response, ['GET', 'POST']);
  }

  if (pathname === '/api/admin/operator-session' && request.method === 'POST') {
    if (!requireAdmin(request, response)) {
      return;
    }
    const body = await request.json();
    const workspaceId = await getCurrentWorkspaceId();
    const result = await createOperatorSession(body.providerId, workspaceId, 'settings');
    if (result.error) {
      return badRequest(response, result.error);
    }
    return json(response, 201, await sessionSummary(result.session));
  }

  if (pathname === '/api/admin/operator-connections' && request.method === 'GET') {
    if (!requireAdmin(request, response)) {
      return;
    }
    const workspaceId = await getCurrentWorkspaceId();
    return json(response, 200, { connections: await store.listOperatorConnections(workspaceId) });
  }

  if (pathname === '/api/admin/client-link-sessions') {
    if (!requireAdmin(request, response)) {
      return;
    }
    if (request.method === 'GET') {
      return json(response, 200, {
        sessions: await Promise.all((await store.listLinkSessionsBySource('client-link-builder', await getCurrentWorkspaceId())).map((session) => sessionSummary(session))),
      });
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const required = ['partnerId', 'partnerName', 'clientName', 'clientEmail'];
      const missing = required.filter((field) => !body[field]);
      if (missing.length > 0) {
        return badRequest(response, 'Missing required fields', missing);
      }

      const requestedProviders = Array.isArray(body.requestedProviders) ? body.requestedProviders : [];
      if (requestedProviders.length === 0) {
        return badRequest(response, 'Select at least one provider');
      }

      const workspaceId = await getCurrentWorkspaceId();
    const session = await store.createLinkSession({
        partnerId: body.partnerId,
        partnerName: body.partnerName,
        clientName: body.clientName,
        clientEmail: body.clientEmail,
        requestedProviders,
        metadata: {
          source: 'client-link-builder',
          requestedAccess: Array.isArray(body.requestedAccess) ? body.requestedAccess : [],
          notes: body.notes || '',
        },
      }, workspaceId);
      return json(response, 201, await sessionSummary(session));
    }

    return methodNotAllowed(response, ['GET', 'POST']);
  }

  if (pathname === '/api/link-sessions' && request.method === 'POST') {
    return handleCreateSession(request, response);
  }

  if (pathname === '/api/operator/connections') {
    if (!requireAdmin(request, response)) {
      return;
    }

    if (request.method === 'GET') {
      const workspaceId = await getCurrentWorkspaceId();
      const connections = await store.listOperatorConnections(workspaceId);
      return json(response, 200, { connections });
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const workspaceId = await getCurrentWorkspaceId();
      const result = await createOperatorSession(body.providerId, workspaceId, 'operator-api');
      if (result.error) {
        return badRequest(response, result.error);
      }
      return json(response, 201, {
        connectionRequest: {
          providerId: body.providerId,
          sessionId: result.session.id,
          sessionToken: result.session.token,
          launchUrl: `${config.baseUrl}/link/${result.session.token}`,
          status: result.session.status,
        },
        session: await sessionSummary(result.session),
      });
    }

    return methodNotAllowed(response, ['GET', 'POST']);
  }

  const operatorConnectionMatch = pathname.match(/^\/api\/operator\/connections\/([^/]+)$/);
  if (operatorConnectionMatch) {
    if (!requireAdmin(request, response)) {
      return;
    }
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET']);
    }
    const workspaceId = await getCurrentWorkspaceId();
    const connection = await store.getOperatorConnection(operatorConnectionMatch[1], workspaceId);
    if (!connection) {
      return notFound(response, 'Operator connection not found');
    }
    return json(response, 200, { connection });
  }

  if (pathname === '/api/client-sessions' && request.method === 'POST') {
    if (!requireAdmin(request, response)) {
      return;
    }
    const workspaceId = await getCurrentWorkspaceId();
    const result = await createClientSession(await request.json(), workspaceId);
    if (result.error) {
      return badRequest(response, result.error, result.details);
    }
    return json(response, 201, await sessionSummary(result.session));
  }

  const clientSessionByIdMatch = pathname.match(/^\/api\/client-sessions\/([^/]+)$/);
  if (clientSessionByIdMatch) {
    if (!requireAdmin(request, response)) {
      return;
    }
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET']);
    }
    const session = await store.getLinkSessionById(clientSessionByIdMatch[1], await getCurrentWorkspaceId());
    if (!session) {
      return notFound(response, 'Client session not found');
    }
    return json(response, 200, await sessionSummary(session));
  }

  const clientSessionByTokenMatch = pathname.match(/^\/api\/client-sessions\/token\/([^/]+)$/);
  if (clientSessionByTokenMatch) {
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET']);
    }
    const session = await store.getLinkSessionByToken(clientSessionByTokenMatch[1], await getCurrentWorkspaceId());
    if (!validateSession(session, response)) {
      return;
    }
    return json(response, 200, await sessionSummary(session));
  }

  const clientSessionStatusMatch = pathname.match(/^\/api\/client-sessions\/([^/]+)\/status$/);
  if (clientSessionStatusMatch) {
    if (!requireAdmin(request, response)) {
      return;
    }
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET']);
    }
    const session = await store.getLinkSessionById(clientSessionStatusMatch[1], await getCurrentWorkspaceId());
    if (!session) {
      return notFound(response, 'Client session not found');
    }
    return json(response, 200, { session: sessionStatusSummary(session) });
  }

  const clientSessionGrantsMatch = pathname.match(/^\/api\/client-sessions\/([^/]+)\/grants$/);
  if (clientSessionGrantsMatch) {
    if (!requireAdmin(request, response)) {
      return;
    }
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET']);
    }
    const session = await store.getLinkSessionById(clientSessionGrantsMatch[1], await getCurrentWorkspaceId());
    if (!session) {
      return notFound(response, 'Client session not found');
    }
    return json(response, 200, { grants: await store.listGrantsBySessionId(session.id, await getCurrentWorkspaceId()) });
  }

  const clientSessionAssetsMatch = pathname.match(/^\/api\/client-sessions\/([^/]+)\/assets$/);
  if (clientSessionAssetsMatch) {
    if (!requireAdmin(request, response)) {
      return;
    }
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET']);
    }
    const session = await store.getLinkSessionById(clientSessionAssetsMatch[1], await getCurrentWorkspaceId());
    if (!session) {
      return notFound(response, 'Client session not found');
    }
    return json(response, 200, { assets: sessionAssets(session) });
  }

  const sessionMatch = pathname.match(/^\/api\/link-sessions\/([^/]+)$/);
  if (sessionMatch) {
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET']);
    }
    const session = await store.getLinkSessionByToken(sessionMatch[1], await getCurrentWorkspaceId());
    if (!validateSession(session, response)) {
      return;
    }
    return json(response, 200, await sessionSummary(session));
  }

  const connectionMatch = pathname.match(/^\/api\/link-sessions\/([^/]+)\/connections$/);
  if (connectionMatch) {
    if (request.method !== 'POST') {
      return methodNotAllowed(response, ['POST']);
    }
    return handleCreateConnection(request, response, connectionMatch[1]);
  }

  const grantMatch = pathname.match(/^\/api\/link-sessions\/([^/]+)\/grants$/);
  if (grantMatch) {
    if (request.method !== 'POST') {
      return methodNotAllowed(response, ['POST']);
    }
    return handleCreateGrant(request, response, grantMatch[1]);
  }

  const partnerGrantMatch = pathname.match(/^\/api\/partners\/([^/]+)\/grants$/);
  if (partnerGrantMatch) {
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET']);
    }
    return json(response, 200, { grants: await store.listPartnerGrants(partnerGrantMatch[1], await getCurrentWorkspaceId()) });
  }

  const oauthMatch = pathname.match(/^\/oauth\/([^/]+)\/callback$/);
  if (oauthMatch) {
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET']);
    }
    return handleOauthCallback(response, oauthMatch[1], url.searchParams);
  }

  const linkMatch = pathname.match(/^\/link\/([^/]+)$/);
  if (linkMatch) {
    if (request.method !== 'GET') {
      return methodNotAllowed(response, ['GET']);
    }
    const session = await store.getLinkSessionByToken(linkMatch[1], await getCurrentWorkspaceId());
    if (!validateSession(session, response)) {
      return;
    }
    return html(response, 200, await renderLinkPage(session));
  }

  return notFound(response);
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Invalid JSON body');
  }
}
