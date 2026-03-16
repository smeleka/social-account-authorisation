import crypto from 'node:crypto';

export function json(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload, null, 2));
}

export function html(response, status, content) {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(content);
}

export function notFound(response, message = 'Not found') {
  json(response, 404, { error: message });
}

export function badRequest(response, message, details) {
  json(response, 400, { error: message, details });
}

export function methodNotAllowed(response, methods) {
  response.writeHead(405, { allow: methods.join(', ') });
  response.end();
}

export async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error('Invalid JSON body');
  }
}

export function generateId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

export function generateToken(size = 24) {
  return crypto.randomBytes(size).toString('base64url');
}

export function nowIso() {
  return new Date().toISOString();
}

export function addMinutes(dateIso, minutes) {
  return new Date(new Date(dateIso).getTime() + minutes * 60_000).toISOString();
}

export function redactSecret(value) {
  if (!value) {
    return null;
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
