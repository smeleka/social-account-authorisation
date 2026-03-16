import path from 'node:path';

const env = process.env;

function csv(value) {
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
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
  sessionTtlMinutes: Number(env.SESSION_TTL_MINUTES || 30),
  dataDir: path.resolve(process.cwd(), env.DATA_DIR || './data'),
  allowDemoProviderAuth: bool(env.ALLOW_DEMO_PROVIDER_AUTH, true),
  providerDiscoveryFallback: bool(env.PROVIDER_DISCOVERY_FALLBACK, true),
};
