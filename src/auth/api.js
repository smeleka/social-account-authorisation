import crypto from 'node:crypto';
import { config } from '../config.js';

function stripWrappingQuotes(value) {
  const trimmed = String(value || '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizePresentedToken(value) {
  const trimmed = stripWrappingQuotes(value);
  if (trimmed.toLowerCase().startsWith('bearer ')) {
    return trimmed.slice(7).trim();
  }
  return trimmed;
}

function tokenFingerprint(value) {
  const normalized = normalizePresentedToken(value);
  if (!normalized) {
    return '(empty)';
  }
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)} (len:${normalized.length})`;
}

function debugLog(event, details) {
  if (!config.apiAuth.debug) {
    return;
  }
  console.info(`[api-auth] ${event}`, details);
}

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

  debugLog('config', {
    headerName: config.apiAuth.headerName,
    tokenCount: config.apiAuth.tokens.length,
    tokenFingerprints: config.apiAuth.tokens.map(tokenFingerprint),
  });

  const headerValue = request.headers[config.apiAuth.headerName];
  if (!headerValue || Array.isArray(headerValue)) {
    debugLog('request-missing-header', {
      headerName: config.apiAuth.headerName,
      receivedHeaderKeys: Object.keys(request.headers || {}),
    });
    return { ok: false, reason: 'missing' };
  }

  const token = normalizePresentedToken(headerValue);
  if (!token) {
    debugLog('request-empty-header', {
      headerName: config.apiAuth.headerName,
    });
    return { ok: false, reason: 'missing' };
  }

  const matched = config.apiAuth.tokens.some((candidate) => safeEqual(normalizePresentedToken(candidate), token));
  debugLog('request-checked', {
    headerName: config.apiAuth.headerName,
    presentedToken: tokenFingerprint(token),
    matched,
  });
  if (!matched) {
    return { ok: false, reason: 'invalid' };
  }

  return {
    ok: true,
    reason: 'valid',
    headerName: config.apiAuth.headerName,
  };
}
