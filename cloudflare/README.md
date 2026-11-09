# StatLab Cloudflare integration gateway (pre-deployment)

This directory prepares an **opt-in, administrator-only** Cloudflare Worker for OpenRouter and Resend. **It is not the StatLab statistical engine.** The pandas/SciPy/statsmodels/FastAPI application in ../app still needs private Python hosting with authentication, user/session isolation and controlled storage before public rollout.

## 1. Configure credentials

Copy .dev.vars.example to .dev.vars (local development only). Replace placeholders with your own keys. The repository ignores .dev.vars. Never share API keys in a chat, commit, screenshot, frontend bundle or browser code.

Use these exact names:

- OPENROUTER_API_KEY: secret, OpenRouter provider key
- RESEND_API_KEY: secret, Resend provider key
- STATLAB_ADMIN_TOKEN: secret, independent random token of at least 32 characters for administrative requests
- RESEND_TEST_TO_EMAIL: secret, fixed recipient for the one test-email endpoint
- OPENROUTER_MODEL: non-secret Wrangler var, a model ID you have explicitly selected in OpenRouter
- RESEND_FROM_EMAIL: non-secret Wrangler var, a sender email on a domain already verified in Resend
- STATLAB_SITE_URL: non-secret Wrangler var, optional actual site URL for OpenRouter attribution
- INTEGRATIONS_ENABLED: non-secret feature flag, defaults to false and must be deliberately set to "true" before calls are allowed

In Cloudflare Dashboard > Workers & Pages > your Worker > Settings > Variables and Secrets, save the four secrets above using **Secret** type. Or from this directory use:
  
    npx wrangler secret put OPENROUTER_API_KEY
    npx wrangler secret put RESEND_API_KEY
    npx wrangler secret put RESEND_TEST_TO_EMAIL
    npx wrangler secret put STATLAB_ADMIN_TOKEN

Note: wrangler secret put can immediately deploy a new Worker version. For staged changes use the Dashboard workflow or wrangler versions secret put and a deliberate subsequent deployment.

Set OPENROUTER_MODEL to a currently available model ID; do not assume any model is free or included in your account. Set RESEND_FROM_EMAIL only after verifying its domain in Resend. Set INTEGRATIONS_ENABLED to "true" only once credentials and access controls are ready.

## 2. Local verification

From cloudflare/, install or run Wrangler using Node.js. For local development, set the non-secret vars in wrangler.jsonc, and provide secrets in .dev.vars.

    npx wrangler dev

The optional admin endpoints are:
- GET /api/integrations/status: only reports whether integrations are enabled
- POST /api/integrations/explain: bearer admin token; JSON with {"kind":"frequency-summary","summary":"Item 5: N=153, mean=3.21, sample SD=1.45; top answer Agree (45/153).","allowExternalAI":true}
- POST /api/integrations/test-email: bearer admin token; no arbitrary recipients, message content, or account signup. Sends one fixed test to RESEND_TEST_TO_EMAIL

Example (replace the URL with your own local worker URL; do NOT paste actual tokens into shells or screenshots):

    curl -X POST http://127.0.0.1:8787/api/integrations/explain \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $STATLAB_ADMIN_TOKEN" \
      -d '{"kind":"frequency-summary","summary":"Item 5: N=153, mean=3.21, sample SD=1.45.","allowExternalAI":true}'

Running the local tests does not call either provider:

    node --test tests/*.test.mjs

## 3. Important deployment boundary

Do NOT enable this Worker for unrestricted public requests. All costly integrations require the separate admin token. Keep it off until tenant authentication, rate limits, quotas, abuse protection, and data privacy safeguards exist. The AI endpoint explicitly sends user-provided *aggregate summary text* to OpenRouter after an opt-in flag; do not send named respondents, confidential survey records or case-by-case data.

This Worker does not host the Python application, handle user login, send verification/password-reset emails, or provide a production email API. The restricted email endpoint is an administrator-only sender verification test. No production changes or secret values are stored in this repository.

Docs: https://developers.cloudflare.com/workers/configuration/secrets/ , https://openrouter.ai/docs/quickstart , https://resend.com/docs/api-reference/emails/send-email
