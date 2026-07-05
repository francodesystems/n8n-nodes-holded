# @francodesystems-npm/n8n-nodes-holded

[![npm version](https://img.shields.io/npm/v/@francodesystems-npm/n8n-nodes-holded.svg)](https://www.npmjs.com/package/@francodesystems-npm/n8n-nodes-holded)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> n8n community node for [Holded](https://www.holded.com) — the Spanish ERP / invoicing platform used by 100,000+ SMEs.

This is an [n8n](https://n8n.io) community node that lets you use **Holded** in your n8n workflows. Built and maintained by [Francodesystems](https://francodesystems.com), Spanish integrations specialists.

📖 **Project landing**: [francodesystems.com/open-source/n8n-nodes-holded](https://francodesystems.com/open-source/n8n-nodes-holded) — coverage matrix, use cases, technical details.

> **Disclaimer**: This is an unofficial community integration. "Holded" and the Holded logo are trademarks of Holded Technologies S.L. and are used here under nominative fair use to identify the third-party service this node integrates with. This package is not affiliated with, endorsed by, or sponsored by Holded.

[Installation](#installation) · [Operations](#operations) · [Trigger](#trigger) · [Credentials](#credentials) · [Compatibility](#compatibility) · [Usage](#usage) · [Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

In your n8n instance: **Settings → Community Nodes → Install**, and enter:

```
@francodesystems-npm/n8n-nodes-holded
```

## Operations

Targets the **Holded API v2** (current). Every v2 endpoint is exposed: **43 resources, 327 operations**. The Contact resource is hand-tuned for a polished UX (nested address, defaults collection, custom fields as JSON, multipart attachment upload/download); the rest are driven by the catalog scraped from the official Holded developers portal — each operation exposes its path parameters, query filters and request body fields as native n8n inputs.

| Area | Resources |
|---|---|
| **Sales** | Invoice, Sales Order, Sales Receipt, Estimate, Proforma, Credit Note, Sales Credit Note, Delivery Note, Recurring Invoice, Billing Forecast, Numbering Series |
| **Purchases** | Purchase, Purchase Order, Purchase Delivery Note |
| **Catalog** | Product, Service, Price List, Warehouse, Production Order |
| **CRM** | Contact, Contact Group, Opportunity, Funnel, Tag, Event, Booking |
| **Accounting** | Accounting, Payment, Payment Method, Bank Account, Expense Account, Tax, Remittance |
| **Projects & Team** | Project, Project Time Tracking, Task, Employee, Employee Time Tracking, Payroll Record |
| **Other** | Sales Channel, Inbox, Document, Usage |

For complex bodies (invoice lines, custom field arrays, etc.) the corresponding field expects JSON; the dispatcher parses it before sending. Pagination on collection GETs uses Holded's cursor (`limit` + `has_more`) and the node automatically loops when **Return All** is enabled.

> **Looking for v1?** Up to v0.3.x this package shipped both v1 and v2 side by side. Starting from v0.4.0 the focus is v2 only (Holded recommends v2 for all new integrations). If you need v1 endpoints, pin `0.3.8` or open an [issue](https://github.com/francodesystems/n8n-nodes-holded/issues).

## Trigger

The **Holded Trigger** node starts a workflow when Holded sends a webhook — covering all **18 objects / 58 events** (`invoice.create`, `contact.update`, `stock.update`, `purchase.approve`, …).

Holded webhooks are configured **manually** in the Holded dashboard (there is no API to register them), so setup is two steps:

1. Add a **Holded Trigger** node and copy its **Production URL**.
2. In Holded → **Settings → Webhooks**, paste the URL and subscribe to the events you want.

Options:

- **Events** — optionally restrict which events start the workflow (leave empty for all).
- **Signature verification** — attach a **Holded Webhook** credential with the signing secret shown in Holded. When set, the node verifies the `x-holded-webhook-signature` (HMAC-SHA256) header and rejects tampered or unsigned requests with `401`.
- **Payload Only** — output just the raw event object, or (default) wrap it with `event`, `eventId`, `accountId`, `date` and `version` metadata.

`.approve` events exist only for Invoice, Credit Note, Sales Receipt, Purchase, Purchase Refund and Receipt Note; Stock only emits `stock.update`.

## Credentials

You need a Holded API key. Generate one in Holded → **Settings → API → Generate new key**.

| Credential | Auth scheme | Notes |
|---|---|---|
| **Holded V2 API** | `Authorization: Bearer <api_key>` | Tested against `GET /api/v2/contacts?limit=1` |
| **Holded Webhook** | Signing secret (HMAC-SHA256) | Optional. Only used by the Holded Trigger to verify webhook signatures |

**v2 keys have per-scope permissions** (e.g. `contacts:contacts.read`, `contacts:contacts.write`). If a key is missing the scope a given endpoint needs, you get a `403 Forbidden`. Pick the minimum set of scopes when generating the key.

## Compatibility

- Requires n8n version **1.0** or later.
- Node.js **20.15+**.

## Usage

### Sync new Shopify orders to Holded contacts

```
Shopify Trigger (order.created)
  → Holded (Contact / Create)
```

### Daily report of new leads to Slack

```
Schedule Trigger (daily)
  → Holded (Contact / Get Many, filter: lead)
  → Slack (Send message)
```

### Update contact when paid in Stripe

```
Stripe Trigger (charge.succeeded)
  → Holded (Contact / Update, set tag: "paid")
```

## API

This node targets the **Holded REST API v2**: Bearer auth (`Authorization: Bearer <api_key>`), cursor pagination (`cursor`+`limit`+`has_more`), RFC 7807 structured errors, scoped permissions, and a consolidated base URL `/api/v2/<resource>`. Holded's v1 (legacy) is no longer covered from v0.4.0 onwards.

Reference: https://www.holded.com/es/desarrolladores

## Releasing (maintainers)

This package publishes to npm via a GitHub Actions workflow that signs every release with an npm provenance attestation, as required by n8n's verified community node policy (effective May 2026). One-time setup, then every release is a single command.

### One-time setup

Pick one of the two npm authentication methods. **Trusted Publisher** is recommended because no long-lived secret ever lives in this repository.

**Option A — Trusted Publisher (OIDC, recommended):**
1. Log in to npmjs.com → open the package settings for `@francodesystems-npm/n8n-nodes-holded`.
2. Under **Publish access → Trusted Publishers**, click **Add a publisher**.
3. Select **GitHub Actions** and enter:
   - Repository owner: `francodesystems`
   - Repository name: `n8n-nodes-holded`
   - Workflow name: `publish.yml`
   - Environment: leave blank
4. Leave `NPM_TOKEN` unset in this repo's GitHub secrets — OIDC handles auth.

**Option B — npm Automation Token (fallback):**
1. On npmjs.com → Access Tokens → **Generate New Token** → Granular Access Token. Scope to this package, "Read and write".
2. In GitHub → Settings → Secrets and variables → Actions → **New secret** named `NPM_TOKEN`.

### Cutting a release

```bash
npm run release
```

`@n8n/node-cli` will lint, build, prompt for the version bump, update the changelog, commit, tag, and push. The push triggers `.github/workflows/publish.yml`, which:

1. Checks out the tag.
2. Runs `npm ci` with the lockfile.
3. Runs `npm run release` in CI mode, which publishes to npm with `--provenance`.

Provenance attestations are visible on the [npm package page](https://www.npmjs.com/package/@francodesystems-npm/n8n-nodes-holded) and let anyone cryptographically verify the package was built by this exact workflow from this exact repo and commit.

### Verified community node submission

To get the "Verified" badge in n8n's nodes panel (so users can install the package directly without enabling community nodes manually), submit through the [n8n Creator Portal](https://creators.n8n.io) after at least one published release with provenance.

## Resources

- [Project landing on francodesystems.com](https://francodesystems.com/open-source/n8n-nodes-holded) — coverage matrix, use cases, FAQ
- [Holded API v2 — Francodesystems analysis](https://francodesystems.com/holded-api-v2) — v1→v2 migration guide, MCP, technical changes
- [Holded API v2 documentation (official)](https://www.holded.com/es/desarrolladores)
- [Francodesystems Holded integrations catalog](https://francodesystems.com/integraciones)
- [Francodesystems open source contributions](https://francodesystems.com/open-source)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
- [n8n verified node guidelines](https://docs.n8n.io/integrations/creating-nodes/deploy/submit-community-nodes/)

## About

Built and maintained by [Francodesystems](https://francodesystems.com), specialists in Holded integrations for Spanish SMEs. We connect Holded with Shopify, WooCommerce, Stripe, HubSpot, Pipedrive and any system with an API.

If you need help integrating Holded into a complex workflow or want a setup done for you, [get in touch](https://francodesystems.com/contacto).

## License

[MIT](LICENSE)
