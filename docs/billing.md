# Billing and subscriptions

Sailing has three access levels:

- **Free** — upload tracks, view/replay races, and use shared deterministic race performance.
- **Club** — $100/year for the organizer's shared AI Race Dossiers across their races. Multiple race members may each subscribe for a portion of the annual target (for example, $25 + $75).
- **User** — $50/year for personal AI coaching across any boat the user owns or can edit.

`billing_settings.payments_enabled` ships as `false`. While it is off, users explicitly activate User or Club early access without Stripe. Enabling payments in `/admin/billing` changes existing early-access enrollments to `needs_payment`; users then enter a card in Stripe Checkout and receive a 30-day trial.

## Stripe setup

Create one Stripe Product for User AI and one for Club AI. Prices are created dynamically by Checkout so a Club contributor can choose their annual share. Configure these server-only variables in every Vercel environment that should support checkout:

```text
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_USER_PRODUCT_ID=prod_...
STRIPE_CLUB_PRODUCT_ID=prod_...
```

Configure a Stripe webhook endpoint at:

```text
https://sailing-performance.vercel.app/api/webhooks/stripe
```

Subscribe it to:

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `checkout.session.expired`

The webhook verifies the raw request body with `STRIPE_WEBHOOK_SECRET`, records event IDs for idempotency, and projects Stripe subscription state into Postgres. Never grant browser writes to the billing projection tables.

Enable the Stripe Customer Portal for subscription cancellation and payment-method updates. Users open it from `/account/billing`.

## Launch checklist

1. Merge and apply the billing migration while payments remain disabled.
2. Configure the four Stripe environment variables and the webhook endpoint.
3. Confirm `/admin/billing` reports all values as configured.
4. Test User checkout and two Club contributions in Stripe test mode.
5. Confirm webhook events activate entitlements and cancellation removes access.
6. Enable payments from `/admin/billing`.

Club access is currently attached to a race organizer because races have `organizer_id` but no separate durable Club entity. One Club enrollment therefore covers every race that organizer owns.
