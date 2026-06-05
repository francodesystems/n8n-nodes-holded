# @francodesystems-npm/n8n-nodes-holded

[![npm version](https://img.shields.io/npm/v/@francodesystems-npm/n8n-nodes-holded.svg)](https://www.npmjs.com/package/@francodesystems-npm/n8n-nodes-holded)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> n8n community node for [Holded](https://www.holded.com) — the Spanish ERP / invoicing platform used by 100,000+ SMEs.

This is an [n8n](https://n8n.io) community node that lets you use **Holded** in your n8n workflows. Built and maintained by [Francodesystems](https://francodesystems.com), Spanish integrations specialists.

[Installation](#installation) · [Operations](#operations) · [Credentials](#credentials) · [Compatibility](#compatibility) · [Usage](#usage) · [Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

In your n8n instance: **Settings → Community Nodes → Install**, and enter:

```
@francodesystems-npm/n8n-nodes-holded
```

## Operations

The node supports **both Holded API v1 (legacy) and v2 (current)**. Pick the version from the "API Version" dropdown at the top of the node. Each version requires its own credential type.

### v2 — full coverage (current API)

Every Holded v2 endpoint is exposed: **41 resources, 311 operations**. The Contact resource is hand-tuned for a polished UX (nested address, defaults collection, custom fields as JSON); the rest are driven by the catalog scraped from the official Holded developers portal — each operation exposes its path parameters, query filters and request body fields as native n8n inputs.

| Area | Resources |
|---|---|
| **Sales** | Invoice, Sales Order, Sales Receipt, Estimate, Proforma, Credit Note, Sales Credit Note, Delivery Note, Recurring Invoice, Billing Forecast, Numbering Series |
| **Purchases** | Purchase, Purchase Order, Purchase Delivery Note |
| **Catalog** | Product, Service, Price List, Warehouse, Production Order |
| **CRM** | Contact, Contact Group, Opportunity, Funnel, Tag, Event, Booking |
| **Accounting** | Accounting, Payment, Payment Method, Bank Account, Expense Account, Tax, Remittance |
| **Projects & Team** | Project, Project Time Tracking, Task, Employee, Employee Time Tracking, Payroll Record |
| **Other** | Sales Channel, Inbox, Document |

For complex bodies (invoice lines, custom field arrays, etc.) the corresponding field expects JSON; the dispatcher parses it before sending. Pagination on collection GETs uses Holded's cursor (`limit` + `has_more`) and the node automatically loops when **Return All** is enabled.

### v1 — Contact (legacy)

- **Create** a new contact (person or company) with VAT number, IBAN, address, etc.
- **Get** a contact by ID.
- **Get Many** contacts, optionally filtered by type (client / supplier / lead / debtor / creditor), with offset pagination.
- **Update** an existing contact.
- **Delete** a contact.

> Need more v1 resources (Invoice, Product, etc.)? Open an [issue](https://github.com/francodesystems/n8n-nodes-holded/issues) — the v1 catalog is available in `spec/v1-endpoints.json`.

## Credentials

You need a Holded API key. Generate one in Holded → **Settings → API → Generate new key**.

This node ships two credential types:

| Credential | Auth scheme | Use for |
|---|---|---|
| **Holded API** | `key: <api_key>` header | v1 endpoints (legacy) |
| **Holded V2 API** | `Authorization: Bearer <api_key>` | v2 endpoints (current) |

Create the credential that matches the API version you selected on the node. The v2 credential is tested against `GET /api/v2/contacts?limit=1`; v1 against `GET /api/invoicing/v1/contacts?limit=1`.

Note that **v2 keys have per-scope permissions** (e.g. `contacts:contacts.read`, `contacts:contacts.write`). If a key is missing the scope a given endpoint needs, you get a `403 Forbidden`. Pick the minimum set of scopes when generating the key.

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

## API version

This node ships side-by-side support for both Holded API versions:

- **v1** — the legacy API. Header auth (`key: <api_key>`), offset pagination (`page`+`limit`), and resource-prefixed URLs (`/api/invoicing/v1/contacts`, `/api/crm/v1/...`). Existing integrations keep working without changes; Holded has not announced a sunset date.
- **v2** — the current API. Bearer auth (`Authorization: Bearer <api_key>`), cursor pagination (`cursor`+`limit`+`has_more`), RFC 7807 structured errors, scoped permissions, and a consolidated base URL `/api/v2/<resource>`. Use v2 for new integrations.

Pick the version in the "API Version" field at the top of the node. Both versions share the same Resource and Operation UI; field names and request shapes follow the version you selected.

- v1 docs (legacy): https://www.holded.com/es/desarrolladores/v1
- v2 docs (current): https://www.holded.com/es/desarrolladores

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

- [Holded API v1 documentation](https://www.holded.com/es/desarrolladores/v1) — legacy, kept for backward compatibility
- [Holded API v2 documentation](https://www.holded.com/es/desarrolladores) — current
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
- [n8n verified node guidelines](https://docs.n8n.io/integrations/creating-nodes/deploy/submit-community-nodes/)
- [Francodesystems — Holded integration services](https://francodesystems.com/integraciones/holded-shopify)

## About

Built and maintained by [Francodesystems](https://francodesystems.com), specialists in Holded integrations for Spanish SMEs. We connect Holded with Shopify, WooCommerce, Stripe, HubSpot, Pipedrive and any system with an API.

If you need help integrating Holded into a complex workflow or want a setup done for you, [get in touch](https://francodesystems.com/contacto).

## License

[MIT](LICENSE)
