import crypto from 'node:crypto';

// Proxy Binding (CONTEXT.md): opaque token embedded in the API Base URL,
// the only handle the proxy has back to (task_id, agent_id) since it can't
// see the child process's environment variables directly.
export function generateBindingToken(): string {
  return crypto.randomBytes(16).toString('hex');
}
