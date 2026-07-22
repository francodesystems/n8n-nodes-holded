import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { contactV2Fields, contactV2Operations } from './descriptions/ContactV2Description';
import {
	holdedV2ApiRequest,
	holdedV2ApiRequestAllItems,
	holdedV2ApiRequestRaw,
} from './GenericFunctionsV2';
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
		usableAsTool: true,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Interact with the Holded ERP API v2 (contacts, invoices, sales orders, products and more)',
		defaults: {
			name: 'Holded',
		},
		// eslint-plugin-n8n-nodes-base@1.16.6 predates NodeConnectionTypes and only
		// recognizes the 'main' string literal; the enum is the current n8n standard.
		// eslint-disable-next-line n8n-nodes-base/node-class-description-inputs-wrong-regular-node
		inputs: [NodeConnectionTypes.Main],
		// eslint-disable-next-line n8n-nodes-base/node-class-description-outputs-wrong
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'holdedV2Api',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [{ name: 'Contact', value: 'contact' }, ...V2_RESOURCE_OPTIONS].sort((a, b) =>
					a.name.localeCompare(b.name),
				),
				default: 'contact',
			},
			...contactV2Operations,
			...contactV2Fields,
			...v2GeneratedProperties,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData: IDataObject | IDataObject[] = {};

				if (resource === 'contact') {
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

				if (resource !== 'contact') {
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
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
