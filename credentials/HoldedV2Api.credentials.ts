import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class HoldedV2Api implements ICredentialType {
	name = 'holdedV2Api';

	displayName = 'Holded V2 API';

	// eslint-disable-next-line n8n-nodes-base/cred-class-field-documentation-url-miscased
	documentationUrl = 'https://www.holded.com/es/desarrolladores';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Your Holded API key. Generate one in Holded → Settings → API → Generate new key. Each key has scoped permissions (e.g. contacts:contacts.read). v2 uses Bearer authentication, different from v1',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{ $credentials.apiKey }}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.holded.com/api/v2',
			url: '/contacts',
			method: 'GET',
			qs: { limit: 1 },
		},
	};
}
