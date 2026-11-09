// MABRIG StatLab: intentionally limited Cloudflare integration gateway.
// This is not the Python statistics engine or a public user API.
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const MAX_BODY_BYTES = 8192;

function respond(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function adminAuthorized(request, env) {
  const expected = env.STATLAB_ADMIN_TOKEN;
  if (typeof expected !== "string" || expected.length < 32) return false;
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  const supplied = auth.slice(7);
  if (supplied.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) {
    difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return difference === 0;
}

async function parseSmallJson(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") || "")) {
    return { error: respond(415, { error: "Send application/json." }) };
  }
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) return { error: respond(413, { error: "Request too large." }) };
  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
    return { error: respond(413, { error: "Request too large." }) };
  }
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: respond(422, { error: "Expected a JSON object." }) };
    }
    return { value: parsed };
  } catch {
    return { error: respond(400, { error: "Malformed JSON." }) };
  }
}

function validAddress(email) {
  return typeof email === "string" &&
    /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) &&
    !email.endsWith(".invalid");
}

export function createGateway(providerFetch = globalThis.fetch) {
  return {
    async fetch(request, env) {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/api/integrations/status" && request.method === "GET") {
        return respond(200, { service: "MABRIG StatLab integration gateway", enabled: env.INTEGRATIONS_ENABLED === "true" });
      }
      if (pathname !== "/api/integrations/explain" && pathname !== "/api/integrations/test-email") {
        return respond(404, { error: "Not found. The statistical Python API is not hosted here." });
      }
      if (request.method !== "POST") return respond(405, { error: "POST required." });
      if (env.INTEGRATIONS_ENABLED !== "true") return respond(503, { error: "Integrations are disabled." });
      if (!adminAuthorized(request, env)) return respond(401, { error: "Unauthorized." });

      if (pathname === "/api/integrations/explain") {
        const parsed = await parseSmallJson(request);
        if (parsed.error) return parsed.error;
        const input = parsed.value;
        if (input.allowExternalAI !== true || input.kind !== "frequency-summary" ||
            typeof input.summary !== "string" || !input.summary.trim() ||
            input.summary.length > 3000) {
          return respond(422, { error: "Supply a 3,000-character-or-less aggregate summary, kind=frequency-summary and allowExternalAI=true." });
        }
        if (!env.OPENROUTER_API_KEY || !env.OPENROUTER_MODEL ||
            env.OPENROUTER_MODEL.includes("YOUR_")) {
          return respond(503, { error: "OpenRouter is not configured." });
        }
        try {
          const headers = {
            "Authorization": "Bearer " + env.OPENROUTER_API_KEY,
            "Content-Type": "application/json",
            "X-OpenRouter-Title": "MABRIG StatLab",
          };
          if (env.STATLAB_SITE_URL) headers["HTTP-Referer"] = env.STATLAB_SITE_URL;
          const upstream = await providerFetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST", headers,
            body: JSON.stringify({
              model: env.OPENROUTER_MODEL, temperature: 0.2, max_tokens: 600,
              messages: [
                { role: "system", content: "Interpret only the aggregated survey statistics provided. Do not invent individual-level data, p-values, correlations, regressions, hypothesis tests, reliability, or causal claims. Clearly describe uncertainty and limitations. Use simple, concise language." },
                { role: "user", content: input.summary.trim() },
              ],
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (!upstream.ok) return respond(502, { error: "OpenRouter request failed." });
          const payload = await upstream.json();
          const explanation = payload?.choices?.[0]?.message?.content;
          if (typeof explanation !== "string" || !explanation.trim()) {
            return respond(502, { error: "OpenRouter returned no text." });
          }
          return respond(200, { explanation: explanation.slice(0, 6000), aiGenerated: true, dataType: "aggregate-frequency-only" });
        } catch {
          return respond(502, { error: "OpenRouter is temporarily unavailable." });
        }
      }

      // Deliberately restricted: no arbitrary recipients, subjects, or user payload.
      if (!validAddress(env.RESEND_FROM_EMAIL) || !validAddress(env.RESEND_TEST_TO_EMAIL) ||
          !env.RESEND_API_KEY) {
        return respond(503, { error: "Resend sender, fixed recipient, or API key is not configured." });
      }
      try {
        const upstream = await providerFetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + env.RESEND_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: env.RESEND_FROM_EMAIL,
            to: [env.RESEND_TEST_TO_EMAIL],
            subject: "MABRIG StatLab integration test",
            text: "This is an administrator-initiated test email from the StatLab Cloudflare integration gateway.",
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (!upstream.ok) return respond(502, { error: "Resend request failed. Check your verified sender domain." });
        const payload = await upstream.json();
        if (typeof payload?.id !== "string") return respond(502, { error: "Resend returned an unexpected response." });
        return respond(200, { accepted: true, id: payload.id });
      } catch {
        return respond(502, { error: "Resend is temporarily unavailable." });
      }
    },
  };
}

export default createGateway();
