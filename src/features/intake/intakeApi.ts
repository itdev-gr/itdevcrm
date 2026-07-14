// Tiny fetch client for the public intake API (`/api/client-intake`). This is the
// ONLY network surface the wizard touches — it never imports supabase-js or any
// authenticated client. All errors surface as `IntakeApiError` carrying the HTTP
// status + the JSON `error` code so callers can branch (e.g. retry on 429).
import type { IntakeFileState, IntakeLoadResponse } from './types';

const ENDPOINT = '/api/client-intake';

export class IntakeApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string[]>;

  constructor(status: number, code: string, fields?: Record<string, string[]>) {
    super(code);
    this.name = 'IntakeApiError';
    this.status = status;
    this.code = code;
    if (fields) this.fields = fields;
  }
}

async function parse<T>(res: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON body (e.g. a proxy 502) — fall through to the generic error below.
  }
  if (!res.ok) {
    const obj = (body ?? {}) as { error?: string; fields?: Record<string, string[]> };
    throw new IntakeApiError(res.status, obj.error ?? 'unknown', obj.fields);
  }
  return body as T;
}

async function post<T>(
  token: string,
  action: string,
  extra: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, action, ...extra }),
  });
  return parse<T>(res);
}

export function loadForm(token: string): Promise<IntakeLoadResponse> {
  return fetch(`${ENDPOINT}?action=load&token=${encodeURIComponent(token)}`).then((r) =>
    parse<IntakeLoadResponse>(r),
  );
}

export function saveDraft(
  token: string,
  payload: { patch?: Record<string, unknown>; locale?: string },
): Promise<{ ok: boolean }> {
  return post(token, 'save', payload);
}

export function getUploadUrl(
  token: string,
  input: { kind: 'logo' | 'file'; file_name: string; size: number; mime_type: string },
): Promise<{ signed_url: string; upload_token?: string; storage_path: string }> {
  return post(token, 'upload-url', input);
}

export function fileAdded(
  token: string,
  input: {
    kind: 'logo' | 'file';
    storage_path: string;
    file_name: string;
    size: number;
    mime_type: string;
  },
): Promise<IntakeFileState> {
  return post(token, 'file-added', input);
}

export function removeFile(
  token: string,
  input: { id: string } | { kind: 'logo' },
): Promise<IntakeFileState> {
  return post(token, 'file-removed', input);
}

export function submitForm(
  token: string,
  input: { data: Record<string, unknown>; locale: string },
): Promise<{ ok: boolean; missing_items: string[] }> {
  return post(token, 'submit', input);
}

/**
 * PUT the raw file bytes straight to a pre-signed storage URL, reporting 0–100
 * progress. A plain XHR (not fetch) is used so upload progress events are
 * available. `x-upsert` is not sent — the server pre-signed logo upserts.
 */
export function uploadBytes(
  signedUrl: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', signedUrl, true);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new IntakeApiError(xhr.status, 'upload_failed'));
      }
    });
    xhr.addEventListener('error', () => reject(new IntakeApiError(0, 'upload_failed')));
    xhr.addEventListener('abort', () => reject(new IntakeApiError(0, 'aborted')));
    xhr.send(file);
  });
}
