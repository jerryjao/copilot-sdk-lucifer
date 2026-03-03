/**
 * Asana REST API client utilities.
 * Thin wrapper around fetch with Bearer token authentication.
 */

const ASANA_BASE_URL = 'https://app.asana.com/api/1.0';

function getAccessToken(): string {
  const token = process.env.ASANA_ACCESS_TOKEN;
  if (!token) {
    throw new Error('ASANA_ACCESS_TOKEN is not set. Add it to your .env file.');
  }
  return token;
}

export async function asanaFetch<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAccessToken();
  const url = `${ASANA_BASE_URL}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  };

  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Asana API error ${res.status}: ${text}`);
  }

  const json = await res.json() as any;
  // Asana wraps responses in { data: ... }
  return json.data !== undefined ? json.data : json;
}

export async function asanaGet<T = any>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  let url = path;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    if (qs) url += `?${qs}`;
  }
  return asanaFetch<T>(url, { method: 'GET' });
}

export async function asanaPost<T = any>(
  path: string,
  body: Record<string, any>,
): Promise<T> {
  return asanaFetch<T>(path, {
    method: 'POST',
    body: JSON.stringify({ data: body }),
  });
}

export async function asanaPut<T = any>(
  path: string,
  body: Record<string, any>,
): Promise<T> {
  return asanaFetch<T>(path, {
    method: 'PUT',
    body: JSON.stringify({ data: body }),
  });
}
