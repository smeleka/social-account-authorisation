import { store } from './store.js';

let cachedWorkspace = null;

export async function getCurrentWorkspace() {
  if (!cachedWorkspace) {
    cachedWorkspace = await store.getCurrentWorkspace();
  }
  return cachedWorkspace;
}

export async function getCurrentWorkspaceId() {
  const workspace = await getCurrentWorkspace();
  return workspace.id;
}

export async function refreshWorkspaceCache() {
  cachedWorkspace = await store.getCurrentWorkspace();
  return cachedWorkspace;
}
