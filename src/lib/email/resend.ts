import "server-only";

import { Resend } from "resend";

import { getResendApiKey } from "@/lib/email/config";

let resendClient: Resend | null = null;

/** Lazily initialized so Next.js builds do not require runtime secrets. */
export function getResendClient(): Resend {
  if (!resendClient) resendClient = new Resend(getResendApiKey());
  return resendClient;
}
