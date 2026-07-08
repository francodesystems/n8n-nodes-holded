import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { createHmac, timingSafeEqual } from 'crypto';

import { HOLDED_WEBHOOK_EVENT_OPTIONS } from './v2/WebhookEvents';

/**
 * Holded webhooks are configured manually in the Holded dashboard
 * (Settings → Webhooks): there is no API to register them. So this is a
 * manual trigger — n8n exposes a webhook URL that the user pastes into Holded
 * and selects events for. Each delivery is a POST with the event object as the
 * body and metadata in `x-holded-webhook-*` headers.
 *
 * Docs: https://www.holded.com/es/desarrolladores/webhooks
 */
export class HoldedTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Holded Trigger',
		name: 'holdedTrigger',
		icon: 'file:holded.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{($parameter["events"] || []).length ? ($parameter["events"] || []).join(", ") : "All events"}}',
		description: 'Starts the workflow when Holded sends a webhook',
		defaults: {
			name: 'Holded Trigger',
		},
		inputs: [],
		outputs: ['main'],
		credentials: [
			{
				name: 'holdedWebhookApi',
				required: false,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'Copy the <b>Production URL</b> above and add it in Holded → Settings → Webhooks, then subscribe to the events you want. To verify signatures, set the signing secret in a "Holded Webhook" credential.',
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: HOLDED_WEBHOOK_EVENT_OPTIONS,
				default: [],
				description:
					'Only start the workflow for these events. Leave empty to trigger for every event Holded sends to this URL.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Payload Only',
						name: 'payloadOnly',
						type: 'boolean',
						default: false,
						description: 'Whether to output only the raw event object. When off, the output wraps it with event name, event ID, account ID, date and version metadata.',
					},
				],
			},
		],
	};

	// Holded does not expose a webhook-management API, so registration is manual.
	// These no-op hooks keep n8n from trying to auto-create/delete the webhook and
	// make it show the URL for the user to copy.
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const headers = this.getHeaderData() as IDataObject;
		const body = this.getBodyData() as IDataObject;
		const eventName = ((headers['x-holded-webhook-event'] as string) || '').trim();

		// Optional HMAC-SHA256 signature verification.
		let signingSecret = '';
		try {
			const cred = await this.getCredentials('holdedWebhookApi');
			signingSecret = ((cred?.signingSecret as string) || '').trim();
		} catch {
			// No credential attached — signature verification disabled.
		}

		if (signingSecret) {
			const req = this.getRequestObject();
			const rawBody: Buffer =
				(req as unknown as { rawBody?: Buffer }).rawBody ??
				Buffer.from(JSON.stringify(body));
			const expected =
				'sha256=' + createHmac('sha256', signingSecret).update(rawBody).digest('hex');
			const received = (headers['x-holded-webhook-signature'] as string) || '';
			const valid =
				received.length === expected.length &&
				timingSafeEqual(Buffer.from(received), Buffer.from(expected));
			if (!valid) {
				const res = this.getResponseObject();
				res.status(401).send('Invalid Holded webhook signature');
				return { noWebhookResponse: true };
			}
		}

		// Event filter: empty selection means "all events".
		const events = this.getNodeParameter('events', []) as string[];
		if (events.length && eventName && !events.includes(eventName)) {
			// Acknowledge with 200 but do not start the workflow.
			return { webhookResponse: 'OK' };
		}

		const options = this.getNodeParameter('options', {}) as IDataObject;
		const output: IDataObject = options.payloadOnly
			? body
			: {
					event: eventName,
					eventId: headers['x-holded-webhook-id'],
					accountId: headers['x-holded-webhook-account-id'],
					date: headers['x-holded-webhook-date'],
					version: headers['x-holded-webhook-version'],
					data: body,
				};

		return {
			workflowData: [this.helpers.returnJsonArray([output])],
		};
	}
}
