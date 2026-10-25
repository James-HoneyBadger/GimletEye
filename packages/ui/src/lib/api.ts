export interface ArgSpec {
  name: string;
  type: 'string' | 'integer' | 'boolean' | 'path' | 'enum';
  required?: boolean;
  default?: unknown;
  help?: string;
  values?: string[];
}

export interface ToolManifest {
  id: string;
  title: string;
  summary: string;
  category: string;
  capabilities?: string[];
  args?: ArgSpec[];
  tags?: string[];
  origin: string;
  version?: string;
  /** The tool can write to this machine. */
  mutates?: boolean;
}

export interface PackSummary {
  name: string;
  version: string;
  description?: string;
  dir: string;
  tool_count: number;
  capabilities: string[];
}

export interface Finding {
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  code: string;
  message: string;
  target?: string;
}

export interface Report {
  tool: string;
  status: 'ok' | 'warning' | 'error';
  summary: string;
  findings?: Finding[];
  data?: unknown;
  body?: string;
  warnings?: string[];
  duration_ms: number;
}

export interface Health {
  status: string;
  version: string;
  tools: number;
  packs: number;
}

export interface AuditEntry {
  ts: string;
  tool: string;
  status: 'ok' | 'warning' | 'error';
  duration_ms: number;
  arg_keys?: string[];
}

export interface AuditTrail {
  enabled: boolean;
  path: string | null;
  entries: AuditEntry[];
}

declare global {
  interface Window {
    __MELLIVORA_API__?: string;
    __MELLIVORA_TOKEN__?: string;
  }
}

const TOKEN_KEY = 'mellivora.api.token';

/**
 * The token arrives from the desktop shell (injected), from the fragment of the
 * URL `mellivora serve` prints, or from a previous session.
 */
function bootToken(): string {
  if (window.__MELLIVORA_TOKEN__) return window.__MELLIVORA_TOKEN__;

  const fromHash = /(?:^#|&)token=([^&]*)/.exec(location.hash);
  if (fromHash) {
    const token = decodeURIComponent(fromHash[1]);
    // Drop it from the address bar and the history entry before the first call.
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    if (token) localStorage.setItem(TOKEN_KEY, token);
    return token;
  }

  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

let apiToken = bootToken();

export const hasApiToken = (): boolean => apiToken.length > 0;

export function setApiToken(value: string): void {
  apiToken = value.trim();
  try {
    if (apiToken) localStorage.setItem(TOKEN_KEY, apiToken);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private browsing: the token still works for this session.
  }
}

/** A 401 from the engine: the token is missing, stale, or wrong. */
export class UnauthorizedError extends Error {
  constructor() {
    super('The API token is missing or wrong.');
    this.name = 'UnauthorizedError';
  }
}

function defaultApiBase(): string {
  // The dev server is a separate origin from the engine; a built bundle is
  // served by the engine itself, or has its base injected by the desktop shell.
  return import.meta.env.DEV ? 'http://127.0.0.1:7878' : '';
}

export const API_BASE: string =
  window.__MELLIVORA_API__ ?? (import.meta.env.VITE_API_BASE as string | undefined) ?? defaultApiBase();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('content-type', 'application/json');
  if (apiToken) headers.set('authorization', `Bearer ${apiToken}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new Error(`Cannot reach the toolkit API at ${API_BASE || location.origin}. Is "mellivora serve" running?`);
  }

  if (response.status === 401) throw new UnauthorizedError();

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `${response.status} ${response.statusText}`);
  }
  return payload as T;
}

export const fetchHealth = () => request<Health>('/api/v1/health');
export const fetchTools = () => request<ToolManifest[]>('/api/v1/tools');
export const fetchPacks = () => request<PackSummary[]>('/api/v1/packs');
export const fetchAudit = (limit = 50) => request<AuditTrail>(`/api/v1/audit?limit=${limit}`);

export const runTool = (tool: string, args: Record<string, unknown>, dryRun: boolean) =>
  request<Report>('/api/v1/run', {
    method: 'POST',
    body: JSON.stringify({ tool, args, dry_run: dryRun }),
  });
