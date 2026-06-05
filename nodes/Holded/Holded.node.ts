import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { Buffer } from 'buffer';

import { contactFields, contactOperations } from './descriptions/ContactDescription';
import { contactV2Fields, contactV2Operations } from './descriptions/ContactV2Description';
import { holdedApiRequest, holdedApiRequestAllItems } from './GenericFunctions';
import {
	holdedV2ApiRequest,
	holdedV2ApiRequestAllItems,
	holdedV2ApiRequestRaw,
} from './GenericFunctionsV2';
import { dispatchV1Generic } from './v1/dispatcher';
import { V1_RESOURCE_OPTIONS, v1GeneratedProperties } from './v1/V1Generated';
import { dispatchV2Generic } from './v2/dispatcher';
import { V2_RESOURCE_OPTIONS, v2GeneratedProperties } from './v2/V2Generated';

function parseJsonArray(this: IExecuteFunctions, value: string, itemIndex: number): IDataObject[] {
	if (!value || value === '[]') return [];
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed)) {
			throw new NodeOperationError(this.getNode(), 'Expected a JSON array', { itemIndex });
		}
		return parsed as IDataObject[];
	} catch (error) {
		throw new NodeOperationError(
			this.getNode(),
			`Invalid JSON: ${(error as Error).message}`,
			{ itemIndex },
		);
	}
}

function buildV2ContactBody(
	this: IExecuteFunctions,
	itemIndex: number,
	primary: IDataObject,
	collection: IDataObject,
): IDataObject {
	const body: IDataObject = { ...primary };

	const FIELD_MAP: Record<string, string> = {
		isPerson: 'is_person',
		vatNumber: 'vat_number',
		tradeName: 'trade_name',
		customId: 'custom_id',
	};

	for (const [key, value] of Object.entries(collection)) {
		if (value === '' || value === undefined || value === null) continue;
		if (key === 'customFieldsJson') {
			body.custom_fields = parseJsonArray.call(this, value as string, itemIndex);
			continue;
		}
		const mapped = FIELD_MAP[key] ?? key;
		body[mapped] = value;
	}

	const billRaw = (this.getNodeParameter('billAddress', itemIndex, {}) as IDataObject)
		.value as IDataObject | undefined;
	if (billRaw && Object.keys(billRaw).length > 0) {
		const billAddress: IDataObject = {};
		const ADDR_MAP: Record<string, string> = {
			postalCode: 'postal_code',
			countryCode: 'country_code',
		};
		for (const [k, v] of Object.entries(billRaw)) {
			if (v === '' || v === undefined || v === null) continue;
			billAddress[ADDR_MAP[k] ?? k] = v;
		}
		if (Object.keys(billAddress).length > 0) body.bill_address = billAddress;
	}

	const defaultsRaw = (this.getNodeParameter('defaults', itemIndex, {}) as IDataObject)
		.value as IDataObject | undefined;
	if (defaultsRaw && Object.keys(defaultsRaw).length > 0) {
		const defaults: IDataObject = {};
		const DEF_MAP: Record<string, string> = {
			salesChannel: 'sales_channel',
			expensesAccount: 'expenses_account',
			dueDays: 'due_days',
			paymentDay: 'payment_day',
			paymentMethod: 'payment_method',
		};
		for (const [k, v] of Object.entries(defaultsRaw)) {
			if (v === '' || v === undefined || v === null) continue;
			defaults[DEF_MAP[k] ?? k] = v;
		}
		if (Object.keys(defaults).length > 0) body.defaults = defaults;
	}

	return body;
}

export class Holded implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Holded',
		name: 'holded',
		icon: 'file:holded.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Interact with the Holded ERP API (contacts, invoices, products and more)',
		defaults: {
			name: 'Holded',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'holdedApi',
				required: true,
				displayOptions: { show: { apiVersion: ['v1'] } },
			},
			{
				name: 'holdedV2Api',
				required: true,
				displayOptions: { show: { apiVersion: ['v2'] } },
			},
		],
		properties: [
			{
				displayName: 'API Version',
				name: 'apiVersion',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'V1 (Legacy)',
						value: 'v1',
						description:
							'Header auth (key), offset pagination, area-prefixed URLs (invoicing/v1, crm/v1, ...). Resources are a subset of V2 with different field shapes — prefer V2 for new integrations.',
					},
					{
						name: 'V2 (Current)',
						value: 'v2',
						description:
							'Bearer auth, cursor pagination, RFC 7807 errors, full ERP coverage (invoices, sales orders, purchase orders, estimates, etc.). Recommended for new integrations.',
					},
				],
				default: 'v2',
				description:
					'Each version requires its own credential. Resources and operations available differ — switching versions reveals a different set of resources below.',
			},
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { apiVersion: ['v1'] } },
				options: [
					{
						name: 'Contact (V1)',
						value: 'contact',
						description: 'Available in both V1 and V2 — schemas differ between versions',
					},
					...V1_RESOURCE_OPTIONS,
				].sort((a, b) => a.name.localeCompare(b.name)),
				default: 'contact',
			},
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { apiVersion: ['v2'] } },
				options: [
					{
						name: 'Contact (V2)',
						value: 'contact',
						description: 'Available in both V1 and V2 — schemas differ between versions',
					},
					...V2_RESOURCE_OPTIONS,
				].sort((a, b) => a.name.localeCompare(b.name)),
				default: 'contact',
			},
			...contactOperations,
			...contactFields,
			...contactV2Operations,
			...contactV2Fields,
			...v1GeneratedProperties,
			...v2GeneratedProperties,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const apiVersion = this.getNodeParameter('apiVersion', 0, 'v1') as string;
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData: IDataObject | IDataObject[] = {};

				if (apiVersion === 'v1' && resource === 'contact') {
					if (operation === 'create') {
						const name = this.getNodeParameter('name', i) as string;
						const type = this.getNodeParameter('type', i) as string;
						const additionalFields = this.getNodeParameter(
							'additionalFields',
							i,
							{},
						) as IDataObject;

						const body: IDataObject = {
							name,
							type,
							...additionalFields,
						};

						responseData = (await holdedApiRequest.call(
							this,
							'POST',
							'/invoicing/v1/contacts',
							body,
						)) as IDataObject;
					}

					if (operation === 'get') {
						const contactId = this.getNodeParameter('contactId', i) as string;
						responseData = (await holdedApiRequest.call(
							this,
							'GET',
							`/invoicing/v1/contacts/${contactId}`,
						)) as IDataObject;
					}

					if (operation === 'getAll') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
						const qs: IDataObject = {};
						if (filters.type) qs.type = filters.type;

						if (returnAll) {
							responseData = await holdedApiRequestAllItems.call(
								this,
								'/invoicing/v1/contacts',
								qs,
							);
						} else {
							const limit = this.getNodeParameter('limit', i) as number;
							qs.limit = limit;
							const response = (await holdedApiRequest.call(
								this,
								'GET',
								'/invoicing/v1/contacts',
								{},
								qs,
							)) as IDataObject[] | IDataObject;
							responseData = Array.isArray(response) ? response : [response];
						}
					}

					if (operation === 'update') {
						const contactId = this.getNodeParameter('contactId', i) as string;
						const updateFields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
						responseData = (await holdedApiRequest.call(
							this,
							'PUT',
							`/invoicing/v1/contacts/${contactId}`,
							updateFields,
						)) as IDataObject;
					}

					if (operation === 'delete') {
						const contactId = this.getNodeParameter('contactId', i) as string;
						responseData = (await holdedApiRequest.call(
							this,
							'DELETE',
							`/invoicing/v1/contacts/${contactId}`,
						)) as IDataObject;
					}
				}

				if (apiVersion === 'v2' && resource === 'contact') {
					if (operation === 'create') {
						const name = this.getNodeParameter('name', i) as string;
						const type = this.getNodeParameter('type', i) as string;
						const additionalFields = this.getNodeParameter(
							'additionalFields',
							i,
							{},
						) as IDataObject;
						const body = buildV2ContactBody.call(
							this,
							i,
							{ name, type },
							additionalFields,
						);
						responseData = (await holdedV2ApiRequest.call(
							this,
							'POST',
							'/contacts',
							body,
						)) as IDataObject;
					}

					if (operation === 'get') {
						const contactId = this.getNodeParameter('contactId', i) as string;
						responseData = (await holdedV2ApiRequest.call(
							this,
							'GET',
							`/contacts/${contactId}`,
						)) as IDataObject;
					}

					if (operation === 'getAll') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
						const qs: IDataObject = {};
						const FILTER_MAP: Record<string, string> = { customId: 'custom_id' };
						for (const [k, v] of Object.entries(filters)) {
							if (v === '' || v === undefined || v === null) continue;
							qs[FILTER_MAP[k] ?? k] = v;
						}

						if (returnAll) {
							responseData = await holdedV2ApiRequestAllItems.call(this, '/contacts', qs);
						} else {
							const limit = this.getNodeParameter('limit', i) as number;
							qs.limit = limit;
							const response = (await holdedV2ApiRequest.call(
								this,
								'GET',
								'/contacts',
								{},
								qs,
							)) as IDataObject;
							responseData = Array.isArray(response.items)
								? (response.items as IDataObject[])
								: [];
						}
					}

					if (operation === 'search') {
						const searchName = this.getNodeParameter('searchName', i) as string;
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const qs: IDataObject = { name: searchName };

						if (returnAll) {
							responseData = await holdedV2ApiRequestAllItems.call(
								this,
								'/contacts/search',
								qs,
							);
						} else {
							const limit = this.getNodeParameter('limit', i) as number;
							qs.limit = limit;
							const response = (await holdedV2ApiRequest.call(
								this,
								'GET',
								'/contacts/search',
								{},
								qs,
							)) as IDataObject;
							responseData = Array.isArray(response.items)
								? (response.items as IDataObject[])
								: [];
						}
					}

					if (operation === 'update') {
						const contactId = this.getNodeParameter('contactId', i) as string;
						const name = this.getNodeParameter('name', i) as string;
						const updateFields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
						const body = buildV2ContactBody.call(this, i, { name }, updateFields);
						responseData = (await holdedV2ApiRequest.call(
							this,
							'PUT',
							`/contacts/${contactId}`,
							body,
						)) as IDataObject;
					}

					if (operation === 'delete') {
						const contactId = this.getNodeParameter('contactId', i) as string;
						await holdedV2ApiRequest.call(this, 'DELETE', `/contacts/${contactId}`);
						responseData = { success: true, id: contactId };
					}

					if (operation === 'bulkArchive' || operation === 'bulkDelete') {
						const contactIdsRaw = this.getNodeParameter('contactIds', i) as string;
						const contact_ids = contactIdsRaw
							.split(',')
							.map((s) => s.trim())
							.filter(Boolean);
						const path =
							operation === 'bulkArchive' ? '/contacts/bulk-archive' : '/contacts/bulk-delete';
						await holdedV2ApiRequest.call(this, 'POST', path, { contact_ids });
						responseData = { success: true, count: contact_ids.length };
					}

					if (operation === 'listAttachments') {
						const contactId = this.getNodeParameter('contactId', i) as string;
						responseData = (await holdedV2ApiRequest.call(
							this,
							'GET',
							`/contacts/${contactId}/attachments`,
						)) as IDataObject;
					}

					if (operation === 'getAttachment') {
						const contactId = this.getNodeParameter('contactId', i) as string;
						const filename = this.getNodeParameter('filename', i) as string;
						const buffer = (await holdedV2ApiRequestRaw.call(
							this,
							'GET',
							`/contacts/${contactId}/attachments/${encodeURIComponent(filename)}`,
							{},
							{},
							{},
							'arraybuffer',
						)) as Buffer;
						const binary = await this.helpers.prepareBinaryData(buffer, filename);
						const executionData = this.helpers.constructExecutionMetaData(
							[{ json: { contactId, filename, size: buffer.length }, binary: { data: binary } }],
							{ itemData: { item: i } },
						);
						returnData.push(...executionData);
						continue;
					}

					if (operation === 'uploadAttachment') {
						const contactId = this.getNodeParameter('contactId', i) as string;
						const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
						const binaryData = this.helpers.assertBinaryData(i, binaryPropertyName);
						const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
						const formData = {
							file: {
								value: buffer,
								options: {
									filename: binaryData.fileName ?? 'upload.bin',
									contentType: binaryData.mimeType ?? 'application/octet-stream',
								},
							},
						};
						responseData = (await this.helpers.httpRequestWithAuthentication.call(
							this,
							'holdedV2Api',
							{
								method: 'POST',
								url: `https://api.holded.com/api/v2/contacts/${contactId}/attachments`,
								body: formData,
								headers: { 'Content-Type': 'multipart/form-data' },
							},
						)) as IDataObject;
					}

					if (operation === 'getPortalLink') {
						const contactId = this.getNodeParameter('contactId', i) as string;
						responseData = (await holdedV2ApiRequest.call(
							this,
							'GET',
							`/contacts/${contactId}/portal-link`,
						)) as IDataObject;
					}
				}

				if (apiVersion === 'v1' && resource !== 'contact') {
					responseData = await dispatchV1Generic.call(this, i, resource, operation);
				}

				if (apiVersion === 'v2' && resource !== 'contact') {
					responseData = await dispatchV2Generic.call(this, i, resource, operation);
				}

				const executionData = this.helpers.constructExecutionMetaData(
					this.helpers.returnJsonArray(responseData),
					{ itemData: { item: i } },
				);
				returnData.push(...executionData);
			} catch (error) {
				if (this.continueOnFail()) {
					const executionData = this.helpers.constructExecutionMetaData(
						this.helpers.returnJsonArray({ error: (error as Error).message }),
						{ itemData: { item: i } },
					);
					returnData.push(...executionData);
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
