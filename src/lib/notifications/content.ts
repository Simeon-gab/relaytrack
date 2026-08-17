/**
 * Customer-facing message content, one per notification template
 * (SPEC section 2: assigned, picked_up, nearby, delivered — each carrying
 * the tracking link). Also used as the WhatsApp template body parameters,
 * so the registered Meta templates must take (org, reference, url) in this
 * order — see src/lib/notifications/README.md.
 */

export type NotificationTemplate = "assigned" | "picked_up" | "nearby" | "delivered";

export function isNotificationTemplate(value: string): value is NotificationTemplate {
  return value === "assigned" || value === "picked_up" || value === "nearby" || value === "delivered";
}

export interface MessageContext {
  orgName: string;
  reference: string;
  trackingUrl: string;
}

export function buildMessageText(template: NotificationTemplate, ctx: MessageContext): string {
  switch (template) {
    case "assigned":
      return `${ctx.orgName}: your order ${ctx.reference} has been assigned to a rider. Track it live: ${ctx.trackingUrl}`;
    case "picked_up":
      return `${ctx.orgName}: your order ${ctx.reference} is on its way. Track it live: ${ctx.trackingUrl}`;
    case "nearby":
      return `${ctx.orgName}: your rider is almost there — order ${ctx.reference} arriving soon. ${ctx.trackingUrl}`;
    case "delivered":
      return `${ctx.orgName}: order ${ctx.reference} has been delivered. Delivery details: ${ctx.trackingUrl}`;
  }
}
