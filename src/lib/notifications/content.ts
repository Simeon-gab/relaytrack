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

/**
 * Platform name required in the sign-off. Termii's shared ("default") sender
 * ID is generic, so the body must identify who is writing — they require the
 * message to end with "Powered by <company>". Approval depends on it.
 */
const PLATFORM = "RelayTrack";

/** One SMS segment. Every character past this doubles the price of the send. */
const SEGMENT_LIMIT = 160;

/**
 * Floor for a shortened org name, used twice: below it the name is dropped
 * entirely (a 4-character stub is noise, and the "Powered by" sign-off
 * already identifies the sender), and a word-boundary cut is only taken if
 * it leaves at least this much. "Adebayo" beats "Adebayo Pharmaceut" — the
 * clean word is the brand; the mangled one reads like a bug.
 */
const MIN_ORG_NAME = 6;

/**
 * GSM-7 default alphabet. A single character outside it forces the whole
 * message into UCS-2 and cuts the limit from 160 to 70 — so one naira sign
 * in an org name would put every notification at three segments.
 */
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

/** Encodable, but each costs two septets — they count double against the limit. */
const GSM7_EXTENDED = "^{}\[~]|€";

/**
 * Look-alikes worth keeping rather than dropping. Everything else outside
 * GSM-7 is removed: silently losing a character beats silently tripling the
 * cost of every message for the life of the org.
 */
const TRANSLITERATE: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "′": "'",
  "“": '"', "”": '"', "„": '"', "″": '"',
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-",
  "…": "...",
  " ": " ", " ": " ", " ": " ",
  "₦": "NGN", "•": "-", "·": ".", "«": '"', "»": '"',
};

/** Cost in septets. Extension-table characters count as two. */
function gsm7Length(value: string): number {
  let total = 0;
  for (const ch of value) total += GSM7_EXTENDED.includes(ch) ? 2 : 1;
  return total;
}

/**
 * Force free text from the database (org name, order reference) into GSM-7.
 * These fields are org-entered, so nothing upstream guarantees the charset.
 */
function sanitizeGsm7(value: string): string {
  let out = "";
  for (const ch of value) {
    const mapped = TRANSLITERATE[ch] ?? ch;
    for (const c of mapped) {
      if (GSM7_BASIC.includes(c) || GSM7_EXTENDED.includes(c)) out += c;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Longest prefix of `value` costing at most `budget` septets, cut on a word boundary where one is close enough. */
function truncateGsm7(value: string, budget: number): string {
  let out = "";
  let cost = 0;
  for (const ch of value) {
    const next = cost + gsm7Length(ch);
    if (next > budget) break;
    out += ch;
    cost = next;
  }
  const lastSpace = out.lastIndexOf(" ");
  if (lastSpace >= MIN_ORG_NAME) out = out.slice(0, lastSpace);
  return out.trimEnd();
}

/**
 * Shape mandated by Termii support for default-sender-ID traffic:
 *   Dear Customer, your {Product/Service} order {ORDER_ID} has been {STATUS}.
 *   Powered by {Company}.
 *
 * Status wording is deliberately terse — "assigned" rather than "assigned to
 * a rider" is worth 11 characters, and 11 characters is the difference
 * between one segment and two on every delivery for the life of the product.
 */
const STATUS_CLAUSE: Record<NotificationTemplate, string> = {
  assigned: "has been assigned.",
  picked_up: "has been picked up.",
  nearby: "is arriving soon.",
  delivered: "has been delivered.",
};

/** Sized against the longest clause so one org's name renders identically across all four messages. */
const LONGEST_CLAUSE = Object.values(STATUS_CLAUSE).reduce((a, b) => (gsm7Length(b) >= gsm7Length(a) ? b : a));

// No "Track:" label before the link — it costs 7 characters and a bare URL
// after a status line is already unambiguous. Those 7 characters are what
// keeps a long org name inside one segment.
function compose(orgName: string, reference: string, clause: string, tail: string): string {
  const subject = orgName ? `your ${orgName} order ${reference}` : `your order ${reference}`;
  return `Dear Customer, ${subject} ${clause} ${tail}`;
}

/**
 * Trim the org name to whatever the segment has left. The name is the only
 * field we may shorten: a truncated order reference is a support ticket, and
 * a truncated tracking link is a dead link — both are worse than paying for a
 * second segment. So an extreme reference plus a long URL can still spill
 * past 160; the guard shrinks what it can and the message goes out intact.
 */
function fitOrgName(orgName: string, reference: string, tail: string): string {
  if (gsm7Length(compose(orgName, reference, LONGEST_CLAUSE, tail)) <= SEGMENT_LIMIT) return orgName;
  const overhead = gsm7Length(compose("", reference, LONGEST_CLAUSE, tail));
  const budget = SEGMENT_LIMIT - overhead - 1; // the space separating name from "order"
  if (budget < MIN_ORG_NAME) return "";
  return truncateGsm7(orgName, budget);
}

export function buildMessageText(template: NotificationTemplate, ctx: MessageContext): string {
  const reference = sanitizeGsm7(ctx.reference);
  const tail = `${ctx.trackingUrl} Powered by ${PLATFORM}.`;
  const orgName = fitOrgName(sanitizeGsm7(ctx.orgName), reference, tail);
  // Collapse the gap a missing org name or reference would otherwise leave.
  return compose(orgName, reference, STATUS_CLAUSE[template], tail).replace(/ {2,}/g, " ");
}
