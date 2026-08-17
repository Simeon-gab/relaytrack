import type { NotificationTemplate, MessageContext } from "@/lib/notifications/content";

/**
 * Provider adapters. Both return {ok, response} and never throw — the sweep
 * logs the raw provider response on every attempt (SPEC section 2: "All sends
 * logged with provider response for the audit trail").
 *
 * Config comes from env vars only (SPEC rule 6 — secrets never live in table
 * rows). orgs.whatsapp_config / sms_config stay reserved for non-secret
 * per-org settings (template names, sender ids) when multi-tenancy needs
 * them; the Hungkee pilot is single-org.
 *
 * Missing config is a normal failed send (not a crash): WhatsApp unconfigured
 * -> the sweep falls back to SMS; SMS unconfigured -> the notification ends
 * `failed` with a self-explanatory provider_response.
 */

export interface SendResult {
  ok: boolean;
  response: unknown;
}

const SEND_TIMEOUT_MS = 8_000;

async function post(url: string, body: unknown, headers: Record<string, string>): Promise<SendResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const payload: unknown = await res.json().catch(() => ({ raw: "non-json response" }));
    return { ok: res.ok, response: { status: res.status, body: payload } };
  } catch (error) {
    return { ok: false, response: { error: error instanceof Error ? error.message : String(error) } };
  }
}

/**
 * WhatsApp Cloud API template send. Business-initiated messages must use a
 * pre-registered template; ours are named `relaytrack_<template>` with a
 * 3-parameter body (org, reference, url) — register with Meta before go-live.
 */
export async function sendWhatsApp(
  toPhone: string,
  template: NotificationTemplate,
  ctx: MessageContext,
): Promise<SendResult> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    return { ok: false, response: { error: "whatsapp_not_configured" } };
  }
  return post(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      to: toPhone,
      type: "template",
      template: {
        name: `relaytrack_${template}`,
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: ctx.orgName },
              { type: "text", text: ctx.reference },
              { type: "text", text: ctx.trackingUrl },
            ],
          },
        ],
      },
    },
    { authorization: `Bearer ${accessToken}` },
  );
}

/** Termii SMS send (Nigeria-focused SMS provider — SPEC section 2 fallback). */
export async function sendTermiiSms(toPhone: string, text: string): Promise<SendResult> {
  const apiKey = process.env.TERMII_API_KEY;
  const senderId = process.env.TERMII_SENDER_ID;
  if (!apiKey || !senderId) {
    return { ok: false, response: { error: "termii_not_configured" } };
  }
  return post(
    "https://api.ng.termii.com/api/sms/send",
    {
      api_key: apiKey,
      to: toPhone,
      from: senderId,
      sms: text,
      type: "plain",
      channel: "generic",
    },
    {},
  );
}
