import { catalog } from "./catalog.mjs";
export function handler(getConnection, token) {
  return async (request) => {
    const url = new URL(request.url);
    if (request.headers.has("origin") || request.headers.has("sec-fetch-site"))
      return new Response("Forbidden", { status: 403 });
    if (
      ![`/${token}/v1/chat/completions`, `/${token}/v1/responses`].includes(
        url.pathname,
      ) ||
      request.method !== "POST"
    )
      return new Response("Not found", { status: 404 });
    const c = getConnection();
    if (!c)
      return new Response("DeepWrite is disconnected from Magpie", {
        status: 503,
      });
    try {
      const text = await request.text();
      if (text.length > 32 * 1024 * 1024)
        return new Response("Request too large", { status: 413 });
      const body = JSON.parse(text);
      if (!catalog(c).some((m) => m.id === body.model))
        return new Response(
          "Model changed; restart the DeepWrite conversation",
          { status: 409 },
        );
      const upstream = await fetch(
        `${c.gateway.replace(/\/$/, "")}/${url.pathname.endsWith("/responses") ? "responses" : "chat/completions"}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${c.key}`,
            "user-agent": "DeepWrite-Magpie/0.2.2",
          },
          body: text,
          signal: request.signal,
          redirect: "error",
        },
      );
      const headers = new Headers();
      for (const name of ["content-type", "retry-after", "x-request-id"])
        if (upstream.headers.has(name))
          headers.set(name, upstream.headers.get(name));
      headers.set("cache-control", "no-store");
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch {
      return new Response(
        "Magpie gateway request failed; check Magpie is running.",
        { status: 502 },
      );
    }
  };
}
