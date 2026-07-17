import "server-only";

interface EmailConfiguration {
  apiKey: string;
  from: string;
  fallbackReplyTo: string | null;
  inboundDomain: string | null;
  siteUrl: string;
}

export interface EmailConfigurationStatus {
  apiKeyConfigured: boolean;
  webhookSecretConfigured: boolean;
  fromConfigured: boolean;
  inboundDomainConfigured: boolean;
  from: string | null;
  inboundDomain: string | null;
  webhookUrl: string;
}

function normalizeDomain(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
  if (!normalized) return null;
  if (!/^[a-z0-9.-]+$/.test(normalized) || !normalized.includes(".")) {
    throw new Error("RESEND_INBOUND_DOMAIN must be a domain name without a protocol.");
  }
  return normalized;
}

export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;

  return "http://localhost:3000";
}

export function getEmailConfiguration(): EmailConfiguration {
  const apiKey = getResendApiKey();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!from) throw new Error("Missing RESEND_FROM_EMAIL.");

  return {
    apiKey,
    from,
    fallbackReplyTo: process.env.RESEND_REPLY_TO?.trim() || null,
    inboundDomain: normalizeDomain(process.env.RESEND_INBOUND_DOMAIN),
    siteUrl: getSiteUrl(),
  };
}

export function getResendApiKey(): string {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("Missing RESEND_API_KEY.");
  return apiKey;
}

export function getEmailConfigurationStatus(): EmailConfigurationStatus {
  const siteUrl = getSiteUrl();
  let inboundDomain: string | null = null;
  try {
    inboundDomain = normalizeDomain(process.env.RESEND_INBOUND_DOMAIN);
  } catch {
    inboundDomain = null;
  }
  return {
    apiKeyConfigured: Boolean(process.env.RESEND_API_KEY?.trim()),
    webhookSecretConfigured: Boolean(process.env.RESEND_WEBHOOK_SECRET?.trim()),
    fromConfigured: Boolean(process.env.RESEND_FROM_EMAIL?.trim()),
    inboundDomainConfigured: Boolean(inboundDomain),
    from: process.env.RESEND_FROM_EMAIL?.trim() || null,
    inboundDomain,
    webhookUrl: `${siteUrl}/api/webhooks/resend`,
  };
}

export function getResendWebhookSecret(): string {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("Missing RESEND_WEBHOOK_SECRET.");
  return secret;
}

export function getThreadReplyToAddress(
  threadId: string,
  config = getEmailConfiguration(),
): string | null {
  if (config.inboundDomain) return `reply+${threadId}@${config.inboundDomain}`;
  return config.fallbackReplyTo;
}

export function resolveEmailLink(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const url = new URL(trimmed, `${getSiteUrl()}/`);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) {
    throw new Error("Email links must use HTTPS.");
  }
  return url.toString();
}
