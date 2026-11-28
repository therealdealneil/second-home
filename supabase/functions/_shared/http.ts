export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return null;
}

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

/**
 * Returns a generic client-safe error response (no stack traces or internal IDs).
 */
export function errorResponse(
  status: number,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
  extraHeaders: Record<string, string> = {},
): Response {
  return jsonResponse({ error, message, ...extra }, status, extraHeaders);
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

export async function parseJsonBody(
  req: Request,
  maxBytes = 65_536,
): Promise<{ ok: true; data: unknown } | { ok: false; response: Response }> {
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const parsedLen = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsedLen) && parsedLen > maxBytes) {
      return {
        ok: false,
        response: errorResponse(413, "payload_too_large", "Request body is too large."),
      };
    }
  }

  let rawText: string;
  try {
    rawText = await req.text();
  } catch {
    return {
      ok: false,
      response: errorResponse(400, "invalid_body", "Unable to read request body."),
    };
  }

  if (new TextEncoder().encode(rawText).byteLength > maxBytes) {
    return {
      ok: false,
      response: errorResponse(413, "payload_too_large", "Request body is too large."),
    };
  }

  try {
    return { ok: true, data: JSON.parse(rawText) as unknown };
  } catch {
    return {
      ok: false,
      response: errorResponse(400, "invalid_json", "Request body must be valid JSON."),
    };
  }
}
