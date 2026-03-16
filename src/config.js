import path from 'node:path';

const env = process.env;

function csv(value) {
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
}

function stripWrappingQuotes(value) {
  if (!value) {
    return '';
  }
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function authTokens(value) {
  if (!value) {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => stripWrappingQuotes(String(item))).filter(Boolean);
      }
    } catch {
      // Fall through to plain-text parsing.
    }
  }

  return trimmed
    .split(/[\n,]/)
    .map((item) => stripWrappingQuotes(item))
    .filter(Boolean);
}

function bool(value, fallback = false) {
  if (value == null || value === '') {
    return fallback;
  }
  return value === '1' || value.toLowerCase() === 'true';
}

export const envProviderDefaults = {
  facebook: {
    clientId: env.FACEBOOK_CLIENT_ID || '',
    clientSecret: env.FACEBOOK_CLIENT_SECRET || '',
    scopes: csv(env.FACEBOOK_SCOPES) || [],
  },
  'google-ads': {
    clientId: env.GOOGLE_ADS_CLIENT_ID || '',
    clientSecret: env.GOOGLE_ADS_CLIENT_SECRET || '',
    scopes: csv(env.GOOGLE_ADS_SCOPES),
    developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    loginCustomerId: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '',
  },
  linkedin: {
    clientId: env.LINKEDIN_CLIENT_ID || '',
    clientSecret: env.LINKEDIN_CLIENT_SECRET || '',
    scopes: csv(env.LINKEDIN_SCOPES),
    assetDiscoveryUrl: env.LINKEDIN_ASSET_DISCOVERY_URL || '',
  },
  tiktok: {
    clientId: env.TIKTOK_CLIENT_ID || env.TIKTOK_CLIENT_KEY || '',
    clientSecret: env.TIKTOK_CLIENT_SECRET || '',
    scopes: csv(env.TIKTOK_SCOPES),
    businessAuthUrl: env.TIKTOK_BUSINESS_AUTH_URL || '',
    businessTokenUrl: env.TIKTOK_BUSINESS_TOKEN_URL || '',
    assetDiscoveryUrl: env.TIKTOK_ASSET_DISCOVERY_URL || '',
  },
};

export const config = {
  port: Number(env.PORT || 3000),
  host: env.HOST || '0.0.0.0',
  baseUrl: env.BASE_URL || 'http://localhost:3000',
  appName: env.APP_NAME || 'Authorisation Hub',
  databaseUrl: env.DATABASE_URL || '',
  sessionTtlMinutes: Number(env.SESSION_TTL_MINUTES || 30),
  dataDir: path.resolve(process.cwd(), env.DATA_DIR || './data'),
  allowDemoProviderAuth: bool(env.ALLOW_DEMO_PROVIDER_AUTH, true),
  providerDiscoveryFallback: bool(env.PROVIDER_DISCOVERY_FALLBACK, true),
  admin: (() => {
    const email = env.ADMIN_EMAIL || '';
    const password = env.ADMIN_PASSWORD || '';
    const sessionSecret = env.ADMIN_SESSION_SECRET || '';
    const configured = Boolean(email && password && sessionSecret);
    return {
      email,
      password,
      sessionSecret,
      sessionTtlHours: Number(env.ADMIN_SESSION_TTL_HOURS || 24),
      configured,
      enabled: bool(env.ADMIN_AUTH_ENABLED, configured) && configured,
    };
  })(),
  apiAuth: (() => {
    const headerName = (env.API_AUTH_HEADER_NAME || 'x-ttp-auth').toLowerCase();
    const tokens = authTokens(env.API_AUTH_TOKENS || env.API_AUTH_TOKEN || '');
    const configured = tokens.length > 0;
    return {
      headerName,
      tokens,
      configured,
      enabled: bool(env.API_AUTH_ENABLED, configured) && configured,
      debug: bool(env.API_AUTH_DEBUG, false),
    };
  })(),
  defaultWorkspace: {
    id: env.DEFAULT_WORKSPACE_ID || 'ws_default',
    slug: env.DEFAULT_WORKSPACE_SLUG || 'default',
    name: env.DEFAULT_WORKSPACE_NAME || 'Default Workspace',
    brandName: env.DEFAULT_WORKSPACE_BRAND_NAME || 'Things to Post',
    primaryDomain: env.DEFAULT_WORKSPACE_PRIMARY_DOMAIN || '',
    supportEmail: env.DEFAULT_WORKSPACE_SUPPORT_EMAIL || '',
  },
};
