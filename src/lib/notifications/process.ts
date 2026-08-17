import type { NotificationTemplate, MessageContext } from "@/lib/notifications/content";
import type { SendResult } from "@/lib/notifications/providers";

/**
 * Pure decision logic for one outbox row — separated from the cron route so
 * the fallback rules are unit-testable without a database or providers.
 *
 * Rules (SPEC section 2 + Phase 5 acceptance):
 *  - whatsapp: one attempt. Failure -> row `failed`, enqueue an SMS fallback
 *    for the same order+template ("WhatsApp failure falls back to SMS").
 *    The fallback REPLACES the WhatsApp message — the customer still receives
 *    exactly one message per transition.
 *  - sms: transient failures retry on later sweeps, up to MAX_SMS_ATTEMPTS,
 *    then `failed` for good. No further fallback exists.
 */

export const MAX_SMS_ATTEMPTS = 3;

export interface OutboxRow {
  id: string;
  channel: "whatsapp" | "sms";
  template: NotificationTemplate;
  to_phone: string;
  attempts: number;
}

export interface ProcessDeps {
  sendWhatsApp(toPhone: string, template: NotificationTemplate, ctx: MessageContext): Promise<SendResult>;
  sendSms(toPhone: string, text: string): Promise<SendResult>;
  buildText(template: NotificationTemplate, ctx: MessageContext): string;
}

export interface Outcome {
  /** New status for this row. `queued` means leave it for the next sweep. */
  status: "sent" | "failed" | "queued";
  /** True when a new SMS outbox row should be enqueued for this order+template. */
  enqueueSmsFallback: boolean;
  response: unknown;
}

export async function processNotification(
  row: OutboxRow,
  ctx: MessageContext,
  deps: ProcessDeps,
): Promise<Outcome> {
  if (row.channel === "whatsapp") {
    const result = await deps.sendWhatsApp(row.to_phone, row.template, ctx);
    if (result.ok) {
      return { status: "sent", enqueueSmsFallback: false, response: result.response };
    }
    return { status: "failed", enqueueSmsFallback: true, response: result.response };
  }

  const result = await deps.sendSms(row.to_phone, deps.buildText(row.template, ctx));
  if (result.ok) {
    return { status: "sent", enqueueSmsFallback: false, response: result.response };
  }
  const exhausted = row.attempts + 1 >= MAX_SMS_ATTEMPTS;
  return {
    status: exhausted ? "failed" : "queued",
    enqueueSmsFallback: false,
    response: result.response,
  };
}
