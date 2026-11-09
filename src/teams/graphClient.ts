export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

export async function graphRequest<T = unknown>(
  accessToken: string,
  method: string,
  path: string,
  body?: object
): Promise<T> {
  const url = path.startsWith('https://')
    ? path
    : `https://graph.microsoft.com/v1.0${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('[Teams Graph]', method, path, res.status, text);
    throw new GraphError(`Graph ${method} ${path} failed`, res.status, text);
  }
  if (!text || res.status === 204) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

export interface GraphChatMessage {
  id: string;
  createdDateTime?: string;
  body?: { content?: string; contentType?: string };
  from?: {
    user?: { id?: string; displayName?: string };
    application?: { id?: string; displayName?: string };
  };
}

export interface GraphChatMessageList {
  value?: GraphChatMessage[];
}
