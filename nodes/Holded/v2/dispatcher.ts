import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { holdedV2ApiRequest, holdedV2ApiRequestAllItems } from '../GenericFunctionsV2';
import { V2_CATALOG, type V2EndpointMeta } from './V2Generated';

function parseJsonValue(
	this: IExecuteFunctions,
	value: unknown,
	itemIndex: number,
	fieldName: string,
): unknown {
	if (typeof value !== 'string' || value.trim() === '') return undefined;
	try {
		return JSON.parse(value);
	} catch (error) {
		throw new NodeOperationError(
			this.getNode(),
			`Field "${fieldName}" must be valid JSON: ${(error as Error).message}`,
			{ itemIndex },
		);
	}
}

function splitCsv(value: unknown): string[] | undefined {
	if (typeof value !== 'string') return undefined;
	const parts = value
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	return parts.length ? parts : undefined;
}

function buildPath(meta: V2EndpointMeta, params: Record<string, string>): string {
	let path = meta.path;
	if (path.startsWith('/api/v2')) {
		path = path.slice('/api/v2'.length);
	}
	for (const { name, key } of meta.pathParams) {
		const v = params[name];
		if (v === undefined || v === '') {
			throw new Error(`Missing required path parameter "${name}"`);
		}
		path = path.replace(`{${key}}`, encodeURIComponent(v));
	}
	return path;
}

function collectBody(
	this: IExecuteFunctions,
	meta: V2EndpointMeta,
	itemIndex: number,
): IDataObject {
	const body: IDataObject = {};
	const jsonSet = new Set(meta.bodyJsonKeys);
	const csvSet = new Set(meta.bodyCsvKeys);

	const collectFrom = (source: IDataObject) => {
		for (const [n8nName, apiKey] of Object.entries(meta.bodyMap)) {
			if (!(n8nName in source)) continue;
			const raw = source[n8nName];
			if (raw === '' || raw === undefined || raw === null) continue;
			if (jsonSet.has(n8nName)) {
				const parsed = parseJsonValue.call(this, raw, itemIndex, n8nName);
				if (parsed !== undefined) body[apiKey] = parsed as IDataObject;
				continue;
			}
			if (csvSet.has(n8nName)) {
				const parts = splitCsv(raw);
				if (parts) body[apiKey] = parts;
				continue;
			}
			body[apiKey] = raw as IDataObject[keyof IDataObject];
		}
	};

	// Top-level required fields.
	const topLevel: IDataObject = {};
	for (const n8nName of Object.keys(meta.bodyMap)) {
		try {
			const v = this.getNodeParameter(n8nName, itemIndex, undefined);
			if (v !== undefined) topLevel[n8nName] = v as IDataObject[keyof IDataObject];
		} catch {
			// Field is inside additionalFields collection — handled next.
		}
	}
	collectFrom(topLevel);

	// Optional fields inside the additionalFields collection.
	const additional = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
	collectFrom(additional);

	return body;
}

function collectQuery(this: IExecuteFunctions, meta: V2EndpointMeta, itemIndex: number): IDataObject {
	const qs: IDataObject = {};
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	for (const [n8nName, apiKey] of Object.entries(meta.queryMap)) {
		const v = filters[n8nName];
		if (v === '' || v === undefined || v === null) continue;
		qs[apiKey] = v as IDataObject[keyof IDataObject];
	}
	return qs;
}

function collectPathParams(
	this: IExecuteFunctions,
	meta: V2EndpointMeta,
	itemIndex: number,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const { name } of meta.pathParams) {
		out[name] = String(this.getNodeParameter(name, itemIndex));
	}
	return out;
}

export async function dispatchV2Generic(
	this: IExecuteFunctions,
	itemIndex: number,
	resource: string,
	operation: string,
): Promise<IDataObject | IDataObject[]> {
	const resCat = V2_CATALOG[resource];
	if (!resCat) {
		throw new NodeOperationError(
			this.getNode(),
			`Unknown v2 resource "${resource}"`,
			{ itemIndex },
		);
	}
	const meta = resCat[operation];
	if (!meta) {
		throw new NodeOperationError(
			this.getNode(),
			`Unknown v2 operation "${operation}" for resource "${resource}"`,
			{ itemIndex },
		);
	}

	const pathParams = collectPathParams.call(this, meta, itemIndex);
	const path = buildPath(meta, pathParams);
	const method = meta.method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

	const body =
		method === 'GET' || method === 'DELETE'
			? {}
			: collectBody.call(this, meta, itemIndex);
	const qs = collectQuery.call(this, meta, itemIndex);

	if (meta.collectionGet && method === 'GET') {
		const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
		if (returnAll) {
			return await holdedV2ApiRequestAllItems.call(this, path, qs);
		}
		const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
		qs.limit = limit;
		const response = (await holdedV2ApiRequest.call(this, 'GET', path, {}, qs)) as IDataObject;
		const items = response.items;
		return Array.isArray(items) ? (items as IDataObject[]) : [response];
	}

	if (method === 'DELETE') {
		await holdedV2ApiRequest.call(this, 'DELETE', path, {}, qs);
		return { success: true, ...pathParams };
	}

	const response = (await holdedV2ApiRequest.call(this, method, path, body, qs)) as
		| IDataObject
		| IDataObject[];
	return response;
}
