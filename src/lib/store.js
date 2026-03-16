import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { addMinutes, generateId, generateToken, nowIso } from './utils.js';

const DATA_FILE = path.join(config.dataDir, 'store.json');

function defaultWorkspace() {
  const createdAt = nowIso();
  return {
    id: config.defaultWorkspace.id,
    slug: config.defaultWorkspace.slug,
    name: config.defaultWorkspace.name,
    brandName: config.defaultWorkspace.brandName,
    primaryDomain: config.defaultWorkspace.primaryDomain,
    supportEmail: config.defaultWorkspace.supportEmail,
    createdAt,
    updatedAt: createdAt,
  };
}

function ensureBaseState() {
  return {
    workspaces: [defaultWorkspace()],
    linkSessions: [],
    partnerGrants: [],
    connectionStates: [],
    providerSettings: {},
    operatorConnections: [],
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class JsonStore {
  constructor() {
    fs.mkdirSync(config.dataDir, { recursive: true });
    this.state = this.load();
  }

  get backend() {
    return 'json';
  }

  load() {
    if (!fs.existsSync(DATA_FILE)) {
      return ensureBaseState();
    }

    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const state = {
      ...ensureBaseState(),
      ...parsed,
    };

    if (!Array.isArray(state.workspaces) || state.workspaces.length === 0) {
      state.workspaces = [defaultWorkspace()];
    }

    const workspaceId = state.workspaces[0].id;
    state.linkSessions = state.linkSessions.map((session) => ({ workspaceId, ...session }));
    state.partnerGrants = state.partnerGrants.map((grant) => ({ workspaceId, ...grant }));
    state.operatorConnections = state.operatorConnections.map((connection) => ({ workspaceId, ...connection }));

    if (!state.providerSettings[workspaceId]) {
      const legacySettings = Object.fromEntries(
        Object.entries(state.providerSettings || {}).filter(([, value]) => value && typeof value === 'object' && !('id' in value))
      );
      state.providerSettings = { [workspaceId]: legacySettings };
    }

    return state;
  }

  save() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(this.state, null, 2));
  }

  async getCurrentWorkspace() {
    return clone(this.state.workspaces[0]);
  }

  async listWorkspaces() {
    return clone(this.state.workspaces);
  }

  async createLinkSession(input, workspaceId) {
    const createdAt = nowIso();
    const session = {
      id: generateId('ls'),
      workspaceId,
      token: generateToken(18),
      status: 'pending',
      createdAt,
      expiresAt: addMinutes(createdAt, config.sessionTtlMinutes),
      partnerId: input.partnerId,
      partnerName: input.partnerName,
      clientName: input.clientName,
      clientEmail: input.clientEmail,
      requestedProviders: input.requestedProviders,
      metadata: input.metadata || {},
      connections: [],
      grants: [],
      auditLog: [
        {
          at: createdAt,
          action: 'session_created',
          actor: 'partner',
        },
      ],
    };

    this.state.linkSessions.push(session);
    this.save();
    return clone(session);
  }

  async getLinkSessionByToken(token, workspaceId) {
    const session = this.state.linkSessions.find((item) => item.token === token && item.workspaceId === workspaceId) || null;
    return clone(session);
  }

  async getLinkSessionById(id, workspaceId) {
    const session = this.state.linkSessions.find((item) => item.id === id && item.workspaceId === workspaceId) || null;
    return clone(session);
  }

  async updateLinkSession(token, workspaceId, updater) {
    const session = this.state.linkSessions.find((item) => item.token === token && item.workspaceId === workspaceId);
    if (!session) {
      return null;
    }
    updater(session);
    this.save();
    return clone(session);
  }

  async createConnectionState(connectionState) {
    this.state.connectionStates.push(connectionState);
    this.save();
    return clone(connectionState);
  }

  async consumeConnectionState(stateId) {
    const index = this.state.connectionStates.findIndex((item) => item.id === stateId);
    if (index === -1) {
      return null;
    }
    const [state] = this.state.connectionStates.splice(index, 1);
    this.save();
    return clone(state);
  }

  async upsertGrant(grant, workspaceId) {
    const payload = { workspaceId, ...grant };
    const existingIndex = this.state.partnerGrants.findIndex((item) => item.id === payload.id && item.workspaceId === workspaceId);
    if (existingIndex >= 0) {
      this.state.partnerGrants[existingIndex] = payload;
    } else {
      this.state.partnerGrants.push(payload);
    }
    this.save();
  }

  async listPartnerGrants(partnerId, workspaceId) {
    return clone(this.state.partnerGrants.filter((grant) => grant.partnerId === partnerId && grant.workspaceId === workspaceId));
  }

  async listGrantsBySessionId(sessionId, workspaceId) {
    return clone(this.state.partnerGrants.filter((grant) => grant.sessionId === sessionId && grant.workspaceId === workspaceId));
  }

  async getProviderSettings(workspaceId) {
    return clone(this.state.providerSettings[workspaceId] || {});
  }

  async updateProviderSettings(providerId, nextSettings, workspaceId) {
    this.state.providerSettings[workspaceId] = this.state.providerSettings[workspaceId] || {};
    this.state.providerSettings[workspaceId][providerId] = {
      ...(this.state.providerSettings[workspaceId][providerId] || {}),
      ...nextSettings,
    };
    this.save();
    return clone(this.state.providerSettings[workspaceId][providerId]);
  }

  async upsertOperatorConnection(connection, workspaceId) {
    const payload = { workspaceId, ...connection };
    const index = this.state.operatorConnections.findIndex((item) => item.providerId === payload.providerId && item.workspaceId === workspaceId);
    if (index >= 0) {
      this.state.operatorConnections[index] = {
        ...this.state.operatorConnections[index],
        ...payload,
      };
    } else {
      this.state.operatorConnections.push(payload);
    }
    this.save();
  }

  async listOperatorConnections(workspaceId) {
    return clone(this.state.operatorConnections.filter((item) => item.workspaceId === workspaceId));
  }

  async getOperatorConnection(providerId, workspaceId) {
    const connection = this.state.operatorConnections.find((item) => item.providerId === providerId && item.workspaceId === workspaceId) || null;
    return clone(connection);
  }

  async listLinkSessionsBySource(source, workspaceId) {
    return clone(this.state.linkSessions.filter((session) => session.workspaceId === workspaceId && session.metadata?.source === source));
  }
}

class PostgresStore {
  constructor(pool) {
    this.pool = pool;
  }

  get backend() {
    return 'postgres';
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS provider_credentials (
        workspace_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        data JSONB NOT NULL,
        PRIMARY KEY (workspace_id, provider_id)
      );
      CREATE TABLE IF NOT EXISTS operator_connections (
        workspace_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        data JSONB NOT NULL,
        PRIMARY KEY (workspace_id, provider_id)
      );
      CREATE TABLE IF NOT EXISTS client_sessions (
        workspace_id TEXT NOT NULL,
        token TEXT PRIMARY KEY,
        data JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS partner_grants (
        workspace_id TEXT NOT NULL,
        grant_id TEXT PRIMARY KEY,
        partner_id TEXT NOT NULL,
        data JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS connection_states (
        state_id TEXT PRIMARY KEY,
        data JSONB NOT NULL
      );
    `);

    const workspace = defaultWorkspace();
    await this.pool.query(
      `INSERT INTO workspaces (id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [workspace.id, JSON.stringify(workspace)]
    );
  }

  async getCurrentWorkspace() {
    const result = await this.pool.query('SELECT data FROM workspaces ORDER BY id ASC LIMIT 1');
    return result.rows[0]?.data || null;
  }

  async listWorkspaces() {
    const result = await this.pool.query('SELECT data FROM workspaces ORDER BY id ASC');
    return result.rows.map((row) => row.data);
  }

  async createLinkSession(input, workspaceId) {
    const createdAt = nowIso();
    const session = {
      id: generateId('ls'),
      workspaceId,
      token: generateToken(18),
      status: 'pending',
      createdAt,
      expiresAt: addMinutes(createdAt, config.sessionTtlMinutes),
      partnerId: input.partnerId,
      partnerName: input.partnerName,
      clientName: input.clientName,
      clientEmail: input.clientEmail,
      requestedProviders: input.requestedProviders,
      metadata: input.metadata || {},
      connections: [],
      grants: [],
      auditLog: [{ at: createdAt, action: 'session_created', actor: 'partner' }],
    };
    await this.pool.query('INSERT INTO client_sessions (workspace_id, token, data) VALUES ($1, $2, $3::jsonb)', [workspaceId, session.token, JSON.stringify(session)]);
    return session;
  }

  async getLinkSessionByToken(token, workspaceId) {
    const result = await this.pool.query('SELECT data FROM client_sessions WHERE token = $1 AND workspace_id = $2 LIMIT 1', [token, workspaceId]);
    return result.rows[0]?.data || null;
  }

  async getLinkSessionById(id, workspaceId) {
    const result = await this.pool.query('SELECT data FROM client_sessions WHERE data->>\'id\' = $1 AND workspace_id = $2 LIMIT 1', [id, workspaceId]);
    return result.rows[0]?.data || null;
  }

  async updateLinkSession(token, workspaceId, updater) {
    const session = await this.getLinkSessionByToken(token, workspaceId);
    if (!session) {
      return null;
    }
    updater(session);
    await this.pool.query('UPDATE client_sessions SET data = $3::jsonb WHERE token = $1 AND workspace_id = $2', [token, workspaceId, JSON.stringify(session)]);
    return session;
  }

  async createConnectionState(connectionState) {
    await this.pool.query('INSERT INTO connection_states (state_id, data) VALUES ($1, $2::jsonb)', [connectionState.id, JSON.stringify(connectionState)]);
    return connectionState;
  }

  async consumeConnectionState(stateId) {
    const result = await this.pool.query('DELETE FROM connection_states WHERE state_id = $1 RETURNING data', [stateId]);
    return result.rows[0]?.data || null;
  }

  async upsertGrant(grant, workspaceId) {
    const payload = { workspaceId, ...grant };
    await this.pool.query(
      `INSERT INTO partner_grants (workspace_id, grant_id, partner_id, data) VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (grant_id) DO UPDATE SET data = EXCLUDED.data, partner_id = EXCLUDED.partner_id, workspace_id = EXCLUDED.workspace_id`,
      [workspaceId, payload.id, payload.partnerId, JSON.stringify(payload)]
    );
  }

  async listPartnerGrants(partnerId, workspaceId) {
    const result = await this.pool.query('SELECT data FROM partner_grants WHERE partner_id = $1 AND workspace_id = $2 ORDER BY grant_id ASC', [partnerId, workspaceId]);
    return result.rows.map((row) => row.data);
  }

  async listGrantsBySessionId(sessionId, workspaceId) {
    const result = await this.pool.query('SELECT data FROM partner_grants WHERE data->>\'sessionId\' = $1 AND workspace_id = $2 ORDER BY grant_id ASC', [sessionId, workspaceId]);
    return result.rows.map((row) => row.data);
  }

  async getProviderSettings(workspaceId) {
    const result = await this.pool.query('SELECT provider_id, data FROM provider_credentials WHERE workspace_id = $1', [workspaceId]);
    return Object.fromEntries(result.rows.map((row) => [row.provider_id, row.data]));
  }

  async updateProviderSettings(providerId, nextSettings, workspaceId) {
    const existing = (await this.getProviderSettings(workspaceId))[providerId] || {};
    const payload = { ...existing, ...nextSettings };
    await this.pool.query(
      `INSERT INTO provider_credentials (workspace_id, provider_id, data) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (workspace_id, provider_id) DO UPDATE SET data = EXCLUDED.data`,
      [workspaceId, providerId, JSON.stringify(payload)]
    );
    return payload;
  }

  async upsertOperatorConnection(connection, workspaceId) {
    const payload = { workspaceId, ...connection };
    await this.pool.query(
      `INSERT INTO operator_connections (workspace_id, provider_id, data) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (workspace_id, provider_id) DO UPDATE SET data = EXCLUDED.data`,
      [workspaceId, payload.providerId, JSON.stringify(payload)]
    );
  }

  async listOperatorConnections(workspaceId) {
    const result = await this.pool.query('SELECT data FROM operator_connections WHERE workspace_id = $1 ORDER BY provider_id ASC', [workspaceId]);
    return result.rows.map((row) => row.data);
  }

  async getOperatorConnection(providerId, workspaceId) {
    const result = await this.pool.query('SELECT data FROM operator_connections WHERE workspace_id = $1 AND provider_id = $2 LIMIT 1', [workspaceId, providerId]);
    return result.rows[0]?.data || null;
  }

  async listLinkSessionsBySource(source, workspaceId) {
    const result = await this.pool.query('SELECT data FROM client_sessions WHERE workspace_id = $1 ORDER BY token ASC', [workspaceId]);
    return result.rows.map((row) => row.data).filter((session) => session.metadata?.source === source);
  }
}

async function createStore() {
  if (!config.databaseUrl) {
    return new JsonStore();
  }

  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: config.databaseUrl });
  const store = new PostgresStore(pool);
  await store.init();
  return store;
}

export const store = await createStore();
