import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

const HOLDED_V2_BASE_URL = 'https://api.holded.com/api/v2';

export async function holdedV2ApiRequest(
	this: IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	resource: string,
	body: IDataObject | IDataObject[] = {},
	qs: IDataObject = {},
): Promise<any> {
	const options: IHttpRequestOptions = {
		method,
		url: `${HOLDED_V2_BASE_URL}${resource}`,
		body,
		qs,
		json: true,
	};

	if (method === 'GET' || method === 'DELETE') {
		delete options.body;
	}

	try {
		return await this.helpers.httpRequestWithAuthentication.call(this, 'holdedV2Api', options);
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

export async function holdedV2ApiRequestRaw(
	this: IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	resource: string,
	body: IDataObject | Buffer = {},
	qs: IDataObject = {},
	headers: IDataObject = {},
	encoding: 'arraybuffer' | 'json' = 'json',
): Promise<any> {
	const options: IHttpRequestOptions = {
		method,
		url: `${HOLDED_V2_BASE_URL}${resource}`,
		body,
		qs,
		headers,
		json: encoding === 'json',
		returnFullResponse: false,
		encoding: encoding === 'arraybuffer' ? 'arraybuffer' : undefined,
	};
	if (method === 'GET' || method === 'DELETE') {
		delete options.body;
	}
	try {
		return await this.helpers.httpRequestWithAuthentication.call(this, 'holdedV2Api', options);
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

/**
 * Holded v2 paginates list endpoints with an opaque cursor and a has_more flag.
 * Response shape: { items: [...], cursor: "...", has_more: bool }.
 */
export async function holdedV2ApiRequestAllItems(
	this: IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions,
	resource: string,
	qs: IDataObject = {},
): Promise<IDataObject[]> {
	const returnData: IDataObject[] = [];
	qs.limit = (qs.limit as number) ?? 100;

	const maxPages = 1000;
	let cursor: string | null = null;
	let pages = 0;

	do {
		if (cursor) {
			qs.cursor = cursor;
		} else {
			delete qs.cursor;
		}

		const response = (await holdedV2ApiRequest.call(this, 'GET', resource, {}, qs)) as {
			items?: IDataObject[];
			cursor?: string | null;
			has_more?: boolean;
		};

		const items = Array.isArray(response.items) ? response.items : [];
		returnData.push(...items);

		cursor = response.has_more ? response.cursor ?? null : null;
		pages += 1;
	} while (cursor && pages < maxPages);

	return returnData;
}
