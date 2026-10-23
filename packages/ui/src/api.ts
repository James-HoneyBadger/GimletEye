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

/**
 * Same-origin when the bundle is served by `mellivora serve` (port 7878);
 * otherwise the desktop shell and the Vite dev server talk to the loopback API.
 */
function defaultApiBase(): string {
  if (location.port === '7878') {
    return '';
  }
  return 'http://127.0.0.1:7878';
}

export const API_BASE: string =
  window.__MELLIVORA_API__ ?? (import.meta.env.VITE_API_BASE as string | undefined) ?? defaultApiBase();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error?.message ?? response.statusText;
    throw new Error(message);
  }
  return payload as T;
}

export const fetchHealth = () => request<Health>('/api/v1/health');

export const fetchTools = () => request<ToolManifest[]>('/api/v1/tools');

export const runTool = (tool: string, args: Record<string, unknown>, dryRun: boolean) =>
  request<Report>('/api/v1/run', {
    method: 'POST',
    body: JSON.stringify({ tool, args, dry_run: dryRun }),
  });
