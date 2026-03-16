import crypto from 'node:crypto';
import { config } from '../config.js';

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function isApiAuthEnabled() {
  return config.apiAuth.enabled;
}

export function verifyApiTokenRequest(request) {
  if (!isApiAuthEnabled()) {
    return { ok: false, reason: 'disabled' };
  }

  const headerValue = request.headers[config.apiAuth.headerName];
  if (!headerValue || Array.isArray(headerValue)) {
    return { ok: false, reason: 'missing' };
  }

  const token = String(headerValue).trim();
  if (!token) {
    return { ok: false, reason: 'missing' };
  }

  const matched = config.apiAuth.tokens.some((candidate) => safeEqual(candidate, token));
  if (!matched) {
    return { ok: false, reason: 'invalid' };
  }

  return {
    ok: true,
    reason: 'valid',
    headerName: config.apiAuth.headerName,
  };
}
