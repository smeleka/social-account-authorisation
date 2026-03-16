import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { addMinutes, generateId, generateToken, nowIso } from './utils.js';

const DATA_FILE = path.join(config.dataDir, 'store.json');

function ensureBaseState() {
  return {
    linkSessions: [],
    partnerGrants: [],
    connectionStates: [],
    providerSettings: {},
    operatorConnections: [],
  };
}

export class Store {
  constructor() {
    fs.mkdirSync(config.dataDir, { recursive: true });
    this.state = this.load();
  }

  load() {
    if (!fs.existsSync(DATA_FILE)) {
      return ensureBaseState();
    }

    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...ensureBaseState(),
      ...parsed,
    };
  }

  save() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(this.state, null, 2));
  }

  createLinkSession(input) {
    const createdAt = nowIso();
    const session = {
      id: generateId('ls'),
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
    return session;
  }

  getLinkSessionByToken(token) {
    return this.state.linkSessions.find((session) => session.token === token) || null;
  }

  updateLinkSession(token, updater) {
    const session = this.getLinkSessionByToken(token);
    if (!session) {
      return null;
    }

    updater(session);
    this.save();
    return session;
  }

  createConnectionState(connectionState) {
    this.state.connectionStates.push(connectionState);
    this.save();
    return connectionState;
  }

  consumeConnectionState(stateId) {
    const index = this.state.connectionStates.findIndex((item) => item.id === stateId);
    if (index === -1) {
      return null;
    }

    const [state] = this.state.connectionStates.splice(index, 1);
    this.save();
    return state;
  }

  upsertGrant(grant) {
    const existingIndex = this.state.partnerGrants.findIndex((item) => item.id === grant.id);
    if (existingIndex >= 0) {
      this.state.partnerGrants[existingIndex] = grant;
    } else {
      this.state.partnerGrants.push(grant);
    }
    this.save();
  }

  listPartnerGrants(partnerId) {
    return this.state.partnerGrants.filter((grant) => grant.partnerId === partnerId);
  }

  getProviderSettings() {
    return this.state.providerSettings || {};
  }

  updateProviderSettings(providerId, nextSettings) {
    this.state.providerSettings = this.state.providerSettings || {};
    this.state.providerSettings[providerId] = {
      ...(this.state.providerSettings[providerId] || {}),
      ...nextSettings,
    };
    this.save();
    return this.state.providerSettings[providerId];
  }

  upsertOperatorConnection(connection) {
    const index = (this.state.operatorConnections || []).findIndex((item) => item.providerId === connection.providerId);
    if (index >= 0) {
      this.state.operatorConnections[index] = {
        ...this.state.operatorConnections[index],
        ...connection,
      };
    } else {
      this.state.operatorConnections.push(connection);
    }
    this.save();
  }

  listOperatorConnections() {
    return this.state.operatorConnections || [];
  }

  listLinkSessionsBySource(source) {
    return this.state.linkSessions.filter((session) => session.metadata?.source === source);
  }
}

export const store = new Store();
