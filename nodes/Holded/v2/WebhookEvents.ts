// Holded webhook event catalog.
// Source: https://www.holded.com/es/desarrolladores/webhooks (18 objects, 58 events).
// Webhooks are configured manually in Holded → Settings → Webhooks; there is no
// API to register them, so the trigger node exposes a URL the user pastes there.
//
// Note: the "proforma" object uses the event prefix `proform` (proform.create…).

export interface HoldedWebhookObject {
	/** Event name prefix, e.g. 'invoice' → invoice.create. */
	slug: string;
	/** Human-readable object name. */
	label: string;
	/** Available actions for this object. */
	actions: Array<'create' | 'update' | 'delete' | 'approve'>;
}

export const HOLDED_WEBHOOK_OBJECTS: HoldedWebhookObject[] = [
	// Sales
	{ slug: 'invoice', label: 'Invoice', actions: ['create', 'update', 'delete', 'approve'] },
	{ slug: 'creditnote', label: 'Credit Note', actions: ['create', 'update', 'delete', 'approve'] },
	{ slug: 'proform', label: 'Proforma', actions: ['create', 'update', 'delete'] },
	{ slug: 'salesreceipt', label: 'Sales Receipt', actions: ['create', 'update', 'delete', 'approve'] },
	{ slug: 'estimate', label: 'Estimate', actions: ['create', 'update', 'delete'] },
	{ slug: 'salesorder', label: 'Sales Order', actions: ['create', 'update', 'delete'] },
	{ slug: 'waybill', label: 'Delivery Note', actions: ['create', 'update', 'delete'] },
	{ slug: 'service', label: 'Service', actions: ['create', 'update', 'delete'] },
	// Purchases
	{ slug: 'purchase', label: 'Purchase', actions: ['create', 'update', 'delete', 'approve'] },
	{ slug: 'purchaserefund', label: 'Purchase Refund', actions: ['create', 'update', 'delete', 'approve'] },
	{ slug: 'receipt', label: 'Receipt', actions: ['create', 'update', 'delete'] },
	{ slug: 'purchaseorder', label: 'Purchase Order', actions: ['create', 'update', 'delete'] },
	{ slug: 'receiptnote', label: 'Receipt Note', actions: ['create', 'update', 'delete', 'approve'] },
	{ slug: 'payment', label: 'Payment', actions: ['create', 'update', 'delete'] },
	// Catalog & Contacts
	{ slug: 'contact', label: 'Contact', actions: ['create', 'update', 'delete'] },
	{ slug: 'product', label: 'Product', actions: ['create', 'update', 'delete'] },
	{ slug: 'stock', label: 'Stock', actions: ['update'] },
	{ slug: 'warehouse', label: 'Warehouse', actions: ['create', 'update', 'delete'] },
];

const ACTION_LABEL: Record<string, string> = {
	create: 'Created',
	update: 'Updated',
	delete: 'Deleted',
	approve: 'Approved',
};

/** Flat {name, value} option list for the trigger's multiOptions selector. */
export const HOLDED_WEBHOOK_EVENT_OPTIONS: Array<{ name: string; value: string }> =
	HOLDED_WEBHOOK_OBJECTS.flatMap((o) =>
		o.actions.map((a) => ({
			name: `${o.label} - ${ACTION_LABEL[a]}`,
			value: `${o.slug}.${a}`,
		})),
	);

/** Every valid event name, e.g. 'invoice.create'. */
export const HOLDED_WEBHOOK_EVENT_NAMES: string[] = HOLDED_WEBHOOK_EVENT_OPTIONS.map((o) => o.value);
