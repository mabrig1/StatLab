import test from "node:test";
import assert from "node:assert/strict";
import { createGateway } from "../src/index.mjs";

const BASE = {
  INTEGRATIONS_ENABLED: "true",
  STATLAB_ADMIN_TOKEN: "a-secret-of-at-least-thirty-two-characters",
  OPENROUTER_API_KEY: "test-openrouter-key",
  OPENROUTER_MODEL: "example/model",
  RESEND_API_KEY: "test-resend-key",
  RESEND_FROM_EMAIL: "noreply@verified.example",
  RESEND_TEST_TO_EMAIL: "owner@example.com",
  STATLAB_SITE_URL: "https://statlab.example",
};
function request(path, body, token = BASE.STATLAB_ADMIN_TOKEN) {
  const headers = { Authorization: "Bearer " + token };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return new Request("https://statlab.example" + path, {
    method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("status is public but cannot disclose provider keys", async () => {
  const response = await createGateway().fetch(new Request("https://example.com/api/integrations/status"), BASE);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.equal(text.includes(BASE.OPENROUTER_API_KEY), false);
});

test("disabled integrations make no provider requests", async () => {
  let called = false;
  const worker = createGateway(async () => { called = true; throw Error("provider called"); });
  const res = await worker.fetch(request("/api/integrations/test-email"), { ...BASE, INTEGRATIONS_ENABLED: "false" });
  assert.equal(res.status, 503);
  assert.equal(called, false);
});

test("wrong or missing admin token is rejected", async () => {
  const worker = createGateway(async () => { throw Error("provider called"); });
  assert.equal((await worker.fetch(request("/api/integrations/test-email", undefined, "bad"), BASE)).status, 401);
  assert.equal((await worker.fetch(request("/api/integrations/test-email"), { ...BASE, STATLAB_ADMIN_TOKEN: "" })).status, 401);
});

test("OpenRouter requires explicit approval and summary-only input", async () => {
  const worker = createGateway(async () => { throw Error("provider called"); });
  const bad = await worker.fetch(request("/api/integrations/explain", { summary: "N=153", kind: "frequency-summary" }), BASE);
  assert.equal(bad.status, 422);
});

test("OpenRouter receives only opted-in aggregate text", async () => {
  let upstream;
  const worker = createGateway(async (url, options) => {
    upstream = { url, options };
    return Response.json({ choices: [{ message: { content: "The mean is slightly above neutral." } }] });
  });
  const res = await worker.fetch(request("/api/integrations/explain", {
    kind: "frequency-summary", summary: "N=153, mean=3.21", allowExternalAI: true,
  }), BASE);
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.match(result.explanation, /neutral/);
  assert.equal(upstream.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(upstream.options.headers.Authorization, "Bearer " + BASE.OPENROUTER_API_KEY);
  assert.equal(JSON.parse(upstream.options.body).model, BASE.OPENROUTER_MODEL);
  assert.equal(JSON.stringify(result).includes(BASE.OPENROUTER_API_KEY), false);
});

test("Resend uses configured sender and fixed test recipient only", async () => {
  let captured;
  const worker = createGateway(async (url, options) => {
    captured = { url, options };
    return Response.json({ id: "email-test-id" });
  });
  const res = await worker.fetch(request("/api/integrations/test-email"), BASE);
  assert.equal(res.status, 200);
  const data = JSON.parse(captured.options.body);
  assert.equal(captured.url, "https://api.resend.com/emails");
  assert.equal(captured.options.headers.Authorization, "Bearer " + BASE.RESEND_API_KEY);
  assert.deepEqual(data.to, [BASE.RESEND_TEST_TO_EMAIL]);
  assert.equal(data.from, BASE.RESEND_FROM_EMAIL);
  assert.equal((await res.json()).accepted, true);
});

test("unconfigured sender or model fails closed", async () => {
  const worker = createGateway(async () => { throw Error("provider called"); });
  const email = await worker.fetch(request("/api/integrations/test-email"), { ...BASE, RESEND_FROM_EMAIL: "noreply@example.invalid" });
  const ai = await worker.fetch(request("/api/integrations/explain", {
    kind: "frequency-summary", summary: "N=2", allowExternalAI: true,
  }), { ...BASE, OPENROUTER_MODEL: "" });
  assert.equal(email.status, 503);
  assert.equal(ai.status, 503);
});

test("non-integration API paths are never exposed by the gateway", async () => {
  const worker = createGateway();
  const response = await worker.fetch(new Request("https://example.com/api/datasets"), BASE);
  assert.equal(response.status, 404);
});
