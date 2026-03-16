import crypto from 'node:crypto';
import { config } from '../config.js';

const COOKIE_NAME = 'auth_admin_session';

function isSecureCookie() {
  return config.baseUrl.startsWith('https://');
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function unbase64url(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(value) {
  return crypto.createHmac('sha256', config.admin.sessionSecret).update(value).digest('base64url');
}

export function isAdminAuthEnabled() {
  return config.admin.enabled;
}

export function parseCookies(request) {
  const header = request.headers.cookie || '';
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

export function createAdminSessionCookie() {
  const payload = {
    email: config.admin.email,
    exp: Date.now() + config.admin.sessionTtlHours * 60 * 60 * 1000,
  };
  const encoded = base64url(JSON.stringify(payload));
  const token = `${encoded}.${sign(encoded)}`;
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${isSecureCookie() ? '; Secure' : ''}`;
}

export function clearAdminSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax${isSecureCookie() ? '; Secure' : ''}; Max-Age=0`;
}

export function verifyAdminRequest(request) {
  if (!isAdminAuthEnabled()) {
    return { ok: true, reason: 'disabled' };
  }

  const cookies = parseCookies(request);
  const raw = cookies[COOKIE_NAME];
  if (!raw) {
    return { ok: false, reason: 'missing' };
  }

  const [encoded, signature] = raw.split('.');
  if (!encoded || !signature) {
    return { ok: false, reason: 'invalid' };
  }

  const expected = sign(encoded);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return { ok: false, reason: 'invalid' };
  }

  try {
    const payload = JSON.parse(unbase64url(encoded));
    if (payload.email !== config.admin.email) {
      return { ok: false, reason: 'invalid' };
    }
    if (payload.exp < Date.now()) {
      return { ok: false, reason: 'expired' };
    }
    return { ok: true, reason: 'valid', email: payload.email };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

export function verifyAdminCredentials(email, password) {
  return isAdminAuthEnabled() && email === config.admin.email && password === config.admin.password;
}
