import type {
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class HoldedWebhookApi implements ICredentialType {
	name = 'holdedWebhookApi';

	displayName = 'Holded Webhook API';

	icon = 'file:holded.svg' as const;

	// eslint-disable-next-line n8n-nodes-base/cred-class-field-documentation-url-miscased
	documentationUrl = 'https://www.holded.com/es/desarrolladores/webhooks';

	properties: INodeProperties[] = [
		{
			displayName: 'Signing Secret',
			name: 'signingSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'The signing secret shown in Holded → Settings → Webhooks. When set, the Holded Trigger verifies the x-holded-webhook-signature (HMAC-SHA256) header and rejects unsigned or tampered requests. Optional but strongly recommended',
		},
	];

	// The signing secret is only used locally to verify inbound HMAC signatures;
	// Holded has no endpoint to validate it against. This test simply confirms the
	// Holded API host is reachable so users get feedback that the credential saved.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.holded.com',
			url: '/api/v2/contacts',
			method: 'GET',
		},
	};
}
