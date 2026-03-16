import { config, envProviderDefaults } from '../config.js';
import { store } from '../lib/store.js';
import { generateId, generateToken, nowIso, redactSecret } from '../lib/utils.js';

const providerCatalog = {
  facebook: {
    id: 'facebook',
    name: 'Meta Business',
    scopes: ['business_management', 'ads_management', 'pages_show_list'],
    docs: 'https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow',
  },
  'google-ads': {
    id: 'google-ads',
    name: 'Google Ads',
    scopes: ['https://www.googleapis.com/auth/adwords', 'openid', 'email', 'profile'],
    docs: 'https://developers.google.com/google-ads/api/docs/oauth/user-authentication',
  },
  linkedin: {
    id: 'linkedin',
    name: 'LinkedIn',
    scopes: ['openid', 'profile', 'email'],
    docs: 'https://learn.microsoft.com/en-us/linkedin/shared/authentication/authentication',
  },
  tiktok: {
    id: 'tiktok',
    name: 'TikTok Business',
    scopes: ['user.info.basic'],
    docs: 'https://developers.tiktok.com/doc/oauth-user-access-token-management',
  },
};

function providerSettings(providerId) {
  const defaults = envProviderDefaults[providerId] || null;
  if (!defaults) {
    return null;
  }
  const runtime = store.getProviderSettings()[providerId] || {};
  return {
    ...defaults,
    ...runtime,
    scopes: runtime.scopes && runtime.scopes.length > 0 ? runtime.scopes : defaults.scopes,
  };
}

function configuredScopes(providerId) {
  const provider = providerCatalog[providerId];
  const settings = providerSettings(providerId) || {};
  return settings.scopes && settings.scopes.length > 0 ? settings.scopes : provider.scopes;
}

function redirectUri(providerId) {
  return `${config.baseUrl}/oauth/${providerId}/callback`;
}

function isConfigured(providerId) {
  const settings = providerSettings(providerId);
  return Boolean(settings?.clientId && settings?.clientSecret);
}

function withMetadata(provider) {
  const configured = isConfigured(provider.id);
  return {
    ...provider,
    scopes: configuredScopes(provider.id),
    configured,
    mode: configured ? 'live' : (config.allowDemoProviderAuth ? 'demo' : 'unavailable'),
  };
}

function toUrlEncoded(params) {
  return new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== ''));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }

  if (!response.ok) {
    const message = parsed?.error?.message || parsed?.error_description || parsed?.message || `Request failed with ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = parsed;
    throw error;
  }

  return parsed;
}

function fakeAssetsForProvider(providerId) {
  const catalog = {
    facebook: [
      { id: 'fb_bm_1001', type: 'business_manager', name: 'Fallback Business Manager' },
      { id: 'fb_ad_1002', type: 'ad_account', name: 'Fallback Ad Account' },
      { id: 'fb_pg_1003', type: 'facebook_page', name: 'Fallback Facebook Page' },
    ],
    'google-ads': [
      { id: 'ga_mgr_2001', type: 'manager_account', name: 'Fallback MCC' },
    ],
    linkedin: [
      { id: 'li_org_3001', type: 'organization', name: 'Fallback LinkedIn Organization' },
    ],
    tiktok: [
      { id: 'tt_adv_4001', type: 'advertiser', name: 'Fallback TikTok Advertiser' },
    ],
  };
  return catalog[providerId] || [];
}

async function discoverFacebookAssets(accessToken) {
  const [me, adAccountsResponse, pagesResponse, businessesResponse] = await Promise.all([
    requestJson(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`),
    requestJson(`https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name,account_status&access_token=${encodeURIComponent(accessToken)}`),
    requestJson(`https://graph.facebook.com/v19.0/me/accounts?fields=id,name&access_token=${encodeURIComponent(accessToken)}`),
    requestJson(`https://graph.facebook.com/v19.0/me/businesses?fields=id,name&access_token=${encodeURIComponent(accessToken)}`),
  ]);

  const assets = [
    ...(businessesResponse.data || []).map((item) => ({ id: item.id, type: 'business_manager', name: item.name })),
    ...(adAccountsResponse.data || []).map((item) => ({ id: item.id, type: 'ad_account', name: item.name })),
    ...(pagesResponse.data || []).map((item) => ({ id: item.id, type: 'facebook_page', name: item.name })),
  ];

  return {
    externalUserId: me.id,
    externalUserName: me.name,
    assets,
  };
}

async function discoverGoogleAdsAssets(accessToken) {
  const settings = providerSettings('google-ads');
  const user = await requestJson('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!settings.developerToken) {
    return {
      externalUserId: user.sub || user.email,
      externalUserName: user.name || user.email,
      assets: config.providerDiscoveryFallback ? fakeAssetsForProvider('google-ads') : [],
      discoveryWarning: 'GOOGLE_ADS_DEVELOPER_TOKEN is missing, so live account discovery was skipped.',
    };
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': settings.developerToken,
  };
  if (settings.loginCustomerId) {
    headers['login-customer-id'] = settings.loginCustomerId;
  }

  const customers = await requestJson('https://googleads.googleapis.com/v18/customers:listAccessibleCustomers', { headers });
  const assets = (customers.resourceNames || []).map((resourceName) => ({
    id: resourceName.split('/').pop(),
    type: 'ad_account',
    name: resourceName,
  }));

  return {
    externalUserId: user.sub || user.email,
    externalUserName: user.name || user.email,
    assets,
  };
}

async function discoverLinkedInAssets(accessToken) {
  const user = await requestJson('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!providerSettings('linkedin').assetDiscoveryUrl) {
    return {
      externalUserId: user.sub || user.email,
      externalUserName: user.name || user.email,
      assets: config.providerDiscoveryFallback ? fakeAssetsForProvider('linkedin') : [],
      discoveryWarning: 'LINKEDIN_ASSET_DISCOVERY_URL is not configured, so only member auth is live.',
    };
  }

  const data = await requestJson(providerSettings('linkedin').assetDiscoveryUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return {
    externalUserId: user.sub || user.email,
    externalUserName: user.name || user.email,
    assets: data.assets || [],
  };
}

async function discoverTikTokAssets(accessToken) {
  let profile = null;
  try {
    profile = await requestJson('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    profile = null;
  }

  if (!providerSettings('tiktok').assetDiscoveryUrl) {
    return {
      externalUserId: profile?.data?.user?.open_id || 'tiktok-user',
      externalUserName: profile?.data?.user?.display_name || 'TikTok User',
      assets: config.providerDiscoveryFallback ? fakeAssetsForProvider('tiktok') : [],
      discoveryWarning: 'TIKTOK_ASSET_DISCOVERY_URL is not configured, so advertiser discovery is using fallback data.',
    };
  }

  const data = await requestJson(providerSettings('tiktok').assetDiscoveryUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return {
    externalUserId: profile?.data?.user?.open_id || 'tiktok-user',
    externalUserName: profile?.data?.user?.display_name || 'TikTok User',
    assets: data.assets || [],
  };
}

export function listProviders() {
  return Object.values(providerCatalog).map(withMetadata);
}

export function getProvider(providerId) {
  const provider = providerCatalog[providerId] || null;
  return provider ? withMetadata(provider) : null;
}

export function createAuthorizationUrl({ providerId, stateId }) {
  const provider = getProvider(providerId);
  if (!provider) {
    throw new Error(`Unsupported provider: ${providerId}`);
  }
  if (!provider.configured && !config.allowDemoProviderAuth) {
    throw new Error(`${provider.name} is not configured in the server environment`);
  }
  if (!provider.configured && config.allowDemoProviderAuth) {
    const demoUrl = new URL(`${config.baseUrl}/oauth/${providerId}/callback`);
    demoUrl.search = toUrlEncoded({
      code: `demo_code_${providerId}`,
      state: stateId,
      demo: '1',
    }).toString();
    return {
      stateId,
      url: demoUrl.toString(),
      provider,
    };
  }

  const state = stateId;
  const url = new URL(
    providerId === 'facebook'
      ? 'https://www.facebook.com/v19.0/dialog/oauth'
      : providerId === 'google-ads'
        ? 'https://accounts.google.com/o/oauth2/v2/auth'
        : providerId === 'linkedin'
          ? 'https://www.linkedin.com/oauth/v2/authorization'
          : (providerSettings('tiktok').businessAuthUrl || 'https://www.tiktok.com/v2/auth/authorize/')
  );

  if (providerId === 'facebook') {
    url.search = toUrlEncoded({
      client_id: providerSettings('facebook').clientId,
      redirect_uri: redirectUri(providerId),
      state,
      scope: configuredScopes(providerId).join(','),
      response_type: 'code',
    }).toString();
  } else if (providerId === 'google-ads') {
    url.search = toUrlEncoded({
      client_id: providerSettings('google-ads').clientId,
      redirect_uri: redirectUri(providerId),
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      state,
      scope: configuredScopes(providerId).join(' '),
      include_granted_scopes: 'true',
    }).toString();
  } else if (providerId === 'linkedin') {
    url.search = toUrlEncoded({
      response_type: 'code',
      client_id: providerSettings('linkedin').clientId,
      redirect_uri: redirectUri(providerId),
      state,
      scope: configuredScopes(providerId).join(' '),
    }).toString();
  } else {
    url.search = toUrlEncoded({
      client_key: providerSettings('tiktok').clientId,
      redirect_uri: redirectUri(providerId),
      response_type: 'code',
      state,
      scope: configuredScopes(providerId).join(','),
    }).toString();
  }

  return {
    stateId,
    url: url.toString(),
    provider,
  };
}

export async function exchangeAuthorizationCode({ providerId, code }) {
  if (code.startsWith('demo_code_')) {
    return {
      providerId,
      externalUserId: `${providerId}_demo_user`,
      externalUserName: `${getProvider(providerId)?.name || providerId} Demo User`,
      accessToken: generateToken(24),
      refreshToken: generateToken(24),
      tokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 60).toISOString(),
      connectedAt: nowIso(),
      assets: fakeAssetsForProvider(providerId),
      discoveryWarning: `Demo mode is active for ${getProvider(providerId)?.name || providerId}. Add provider credentials in .env to use real OAuth.`,
    };
  }

  if (providerId === 'facebook') {
    const token = await requestJson(`https://graph.facebook.com/v19.0/oauth/access_token?${toUrlEncoded({
      client_id: providerSettings('facebook').clientId,
      client_secret: providerSettings('facebook').clientSecret,
      redirect_uri: redirectUri(providerId),
      code,
    }).toString()}`);
    const discovery = await discoverFacebookAssets(token.access_token);
    return {
      providerId,
      externalUserId: discovery.externalUserId,
      externalUserName: discovery.externalUserName,
      accessToken: token.access_token,
      refreshToken: null,
      tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null,
      connectedAt: nowIso(),
      assets: discovery.assets,
      discoveryWarning: discovery.discoveryWarning || null,
    };
  }

  if (providerId === 'google-ads') {
    const token = await requestJson('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: toUrlEncoded({
        client_id: providerSettings('google-ads').clientId,
        client_secret: providerSettings('google-ads').clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri(providerId),
      }),
    });
    const discovery = await discoverGoogleAdsAssets(token.access_token);
    return {
      providerId,
      externalUserId: discovery.externalUserId,
      externalUserName: discovery.externalUserName,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || null,
      tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null,
      connectedAt: nowIso(),
      assets: discovery.assets,
      discoveryWarning: discovery.discoveryWarning || null,
    };
  }

  if (providerId === 'linkedin') {
    const token = await requestJson('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: toUrlEncoded({
        grant_type: 'authorization_code',
        code,
        client_id: providerSettings('linkedin').clientId,
        client_secret: providerSettings('linkedin').clientSecret,
        redirect_uri: redirectUri(providerId),
      }),
    });
    const discovery = await discoverLinkedInAssets(token.access_token);
    return {
      providerId,
      externalUserId: discovery.externalUserId,
      externalUserName: discovery.externalUserName,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || null,
      tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null,
      connectedAt: nowIso(),
      assets: discovery.assets,
      discoveryWarning: discovery.discoveryWarning || null,
    };
  }

  if (providerId === 'tiktok') {
    const tokenUrl = providerSettings('tiktok').businessTokenUrl || 'https://open.tiktokapis.com/v2/oauth/token/';
    const token = await requestJson(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: toUrlEncoded({
        client_key: providerSettings('tiktok').clientId,
        client_secret: providerSettings('tiktok').clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri(providerId),
      }),
    });
    const discovery = await discoverTikTokAssets(token.access_token);
    return {
      providerId,
      externalUserId: discovery.externalUserId,
      externalUserName: discovery.externalUserName,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || null,
      tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null,
      connectedAt: nowIso(),
      assets: discovery.assets,
      discoveryWarning: discovery.discoveryWarning || null,
    };
  }

  throw new Error(`Unsupported provider: ${providerId}`);
}

export function serializeConnection(connection) {
  return {
    id: connection.id,
    providerId: connection.providerId,
    providerName: getProvider(connection.providerId)?.name || connection.providerId,
    externalUserId: connection.externalUserId,
    externalUserName: connection.externalUserName || null,
    connectedAt: connection.connectedAt,
    tokenExpiresAt: connection.tokenExpiresAt,
    accessTokenPreview: redactSecret(connection.accessToken),
    refreshTokenPreview: redactSecret(connection.refreshToken),
    discoveryWarning: connection.discoveryWarning || null,
    assets: connection.assets,
  };
}

export function listProviderSettingsForAdmin() {
  return listProviders().map((provider) => {
    const settings = providerSettings(provider.id) || {};
    return {
      id: provider.id,
      name: provider.name,
      configured: provider.configured,
      mode: provider.mode,
      docs: provider.docs,
      scopes: configuredScopes(provider.id),
      settings: {
        clientId: settings.clientId || '',
        hasClientSecret: Boolean(settings.clientSecret),
        developerToken: settings.developerToken || '',
        loginCustomerId: settings.loginCustomerId || '',
        assetDiscoveryUrl: settings.assetDiscoveryUrl || '',
        businessAuthUrl: settings.businessAuthUrl || '',
        businessTokenUrl: settings.businessTokenUrl || '',
      },
    };
  });
}
