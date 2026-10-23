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

declare global {
  interface Window {
    __MELLIVORA_API__?: string;
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
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error(`Cannot reach the toolkit API at ${API_BASE || location.origin}. Is "mellivora serve" running?`);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `${response.status} ${response.statusText}`);
  }
  return payload as T;
}

export const fetchHealth = () => request<Health>('/api/v1/health');
export const fetchTools = () => request<ToolManifest[]>('/api/v1/tools');
export const fetchPacks = () => request<PackSummary[]>('/api/v1/packs');

export const runTool = (tool: string, args: Record<string, unknown>, dryRun: boolean) =>
  request<Report>('/api/v1/run', {
    method: 'POST',
    body: JSON.stringify({ tool, args, dry_run: dryRun }),
  });
