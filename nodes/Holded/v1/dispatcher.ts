import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { holdedApiRequest, holdedApiRequestAllItems } from '../GenericFunctions';
import { V1_CATALOG, type V1EndpointMeta } from './V1Generated';

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

function buildPath(meta: V1EndpointMeta, params: Record<string, string>): string {
	let path = meta.path;
	for (const { key } of meta.pathParams) {
		const v = params[key] ?? params[meta.pathParams.find((p) => p.key === key)?.name ?? ''];
		if (v === undefined || v === '') {
			throw new Error(`Missing required path parameter "${key}"`);
		}
		path = path.replace(`{${key}}`, encodeURIComponent(v));
	}
	return path;
}

function collectBody(
	this: IExecuteFunctions,
	meta: V1EndpointMeta,
	itemIndex: number,
): IDataObject {
	const body: IDataObject = {};
	const jsonSet = new Set(meta.bodyJsonKeys);
	const csvSet = new Set(meta.bodyCsvKeys);

	const merge = (source: IDataObject) => {
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

	const topLevel: IDataObject = {};
	for (const n8nName of Object.keys(meta.bodyMap)) {
		try {
			const v = this.getNodeParameter(n8nName, itemIndex, undefined);
			if (v !== undefined) topLevel[n8nName] = v as IDataObject[keyof IDataObject];
		} catch {
			/* field is inside additionalFields */
		}
	}
	merge(topLevel);

	const additional = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
	merge(additional);
	return body;
}

function collectQuery(this: IExecuteFunctions, meta: V1EndpointMeta, itemIndex: number): IDataObject {
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
	meta: V1EndpointMeta,
	itemIndex: number,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const { name, key } of meta.pathParams) {
		const v = String(this.getNodeParameter(name, itemIndex));
		out[name] = v;
		out[key] = v;
	}
	return out;
}

export async function dispatchV1Generic(
	this: IExecuteFunctions,
	itemIndex: number,
	resource: string,
	operation: string,
): Promise<IDataObject | IDataObject[]> {
	const resCat = V1_CATALOG[resource];
	if (!resCat) {
		throw new NodeOperationError(
			this.getNode(),
			`Unknown v1 resource "${resource}"`,
			{ itemIndex },
		);
	}
	const meta = resCat[operation];
	if (!meta) {
		throw new NodeOperationError(
			this.getNode(),
			`Unknown v1 operation "${operation}" for resource "${resource}"`,
			{ itemIndex },
		);
	}

	const pathParams = collectPathParams.call(this, meta, itemIndex);
	const path = buildPath(meta, pathParams);
	const method = meta.method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

	const body = method === 'GET' || method === 'DELETE' ? {} : collectBody.call(this, meta, itemIndex);
	const qs = collectQuery.call(this, meta, itemIndex);

	if (meta.collectionGet && method === 'GET') {
		const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
		if (returnAll) {
			return await holdedApiRequestAllItems.call(this, path, qs);
		}
		const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
		qs.limit = limit;
		const response = (await holdedApiRequest.call(this, 'GET', path, {}, qs)) as
			| IDataObject
			| IDataObject[];
		return Array.isArray(response) ? response : [response];
	}

	if (method === 'DELETE') {
		await holdedApiRequest.call(this, 'DELETE', path, {}, qs);
		return { success: true, ...pathParams };
	}

	const response = (await holdedApiRequest.call(this, method, path, body, qs)) as
		| IDataObject
		| IDataObject[];
	return response;
}
