export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(typeof FormData !== "undefined" && init?.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function uploadWithProgress<T>(path: string, body: FormData, onProgress: (percent: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api${path}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onload = () => {
      let response: { error?: string } & T;
      try { response = JSON.parse(xhr.responseText) as { error?: string } & T; }
      catch { response = {} as { error?: string } & T; }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(response.error ?? `Upload failed (${xhr.status})`));
        return;
      }
      onProgress(100);
      resolve(response);
    };
    xhr.send(body);
  });
}
