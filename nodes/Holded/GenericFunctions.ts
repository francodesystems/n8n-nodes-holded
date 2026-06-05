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

const HOLDED_BASE_URL = 'https://api.holded.com/api';

export async function holdedApiRequest(
	this: IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	resource: string,
	body: IDataObject | IDataObject[] = {},
	qs: IDataObject = {},
): Promise<any> {
	const options: IHttpRequestOptions = {
		method,
		url: `${HOLDED_BASE_URL}${resource}`,
		body,
		qs,
		json: true,
	};

	if (method === 'GET' || method === 'DELETE') {
		delete options.body;
	}

	try {
		return await this.helpers.httpRequestWithAuthentication.call(this, 'holdedApi', options);
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

/**
 * Holded paginates list endpoints with `page` and `limit` but does not return
 * metadata. We iterate page by page until the response array shorter than the
 * requested limit (or empty).
 */
export async function holdedApiRequestAllItems(
	this: IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions,
	resource: string,
	qs: IDataObject = {},
): Promise<IDataObject[]> {
	const returnData: IDataObject[] = [];
	const pageSize = (qs.limit as number) ?? 100;
	let page = 1;
	qs.limit = pageSize;

	// hard cap to avoid runaway loops if the API ever changes shape
	const maxPages = 1000;

	while (page <= maxPages) {
		qs.page = page;
		const response = (await holdedApiRequest.call(this, 'GET', resource, {}, qs)) as
			| IDataObject[]
			| IDataObject;

		const items = Array.isArray(response) ? response : [response];
		if (items.length === 0) break;

		returnData.push(...items);
		if (items.length < pageSize) break;
		page += 1;
	}

	return returnData;
}
