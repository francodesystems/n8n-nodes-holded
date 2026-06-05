import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class HoldedApi implements ICredentialType {
	name = 'holdedApi';

	displayName = 'Holded API';

	// eslint-disable-next-line n8n-nodes-base/cred-class-field-documentation-url-miscased
	documentationUrl = 'https://www.holded.com/es/desarrolladores/v1';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Your Holded API key. Generate one in Holded → Settings → Developers → API keys. This node targets the Holded REST API v1 (the production API as of 2026).',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				key: '={{ $credentials.apiKey }}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.holded.com/api',
			url: '/invoicing/v1/contacts',
			method: 'GET',
			qs: { limit: 1 },
		},
	};
}
