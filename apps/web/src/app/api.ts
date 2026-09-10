export const CLIENT_LIST_CAP = 100;

export type Domain = {
  id: string;
  name: string;
  description: string;
  status: string;
  comingSoon: boolean;
  selectable: boolean;
  supported: boolean;
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(body.error?.message ?? `HTTP ${response.status}`);
  }
  return body;
}

export function takeBoundedClient<T>(current: T[], extra: T[]): T[] {
  return [...current, ...extra].slice(0, CLIENT_LIST_CAP);
}
