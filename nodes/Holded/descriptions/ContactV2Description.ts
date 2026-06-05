import type { INodeProperties } from 'n8n-workflow';

const TYPE_OPTIONS = [
	{ name: 'Client', value: 'client' },
	{ name: 'Creditor', value: 'creditor' },
	{ name: 'Debtor', value: 'debtor' },
	{ name: 'Lead', value: 'lead' },
	{ name: 'Supplier', value: 'supplier' },
];

const BILL_ADDRESS_FIELDS: INodeProperties[] = [
	{ displayName: 'Address', name: 'address', type: 'string', default: '' },
	{ displayName: 'City', name: 'city', type: 'string', default: '' },
	{
		displayName: 'Country',
		name: 'country',
		type: 'string',
		default: '',
	},
	{
		displayName: 'Country Code',
		name: 'countryCode',
		type: 'string',
		default: '',
		description: 'ISO 3166-1 alpha-2 country code (e.g. ES, FR, DE)',
	},
	{
		displayName: 'Info',
		name: 'info',
		type: 'string',
		default: '',
		description: 'Additional address info (floor, door, etc.)',
	},
	{ displayName: 'Postal Code', name: 'postalCode', type: 'string', default: '' },
	{ displayName: 'Province', name: 'province', type: 'string', default: '' },
];

const DEFAULTS_FIELDS: INodeProperties[] = [
	{
		displayName: 'Currency',
		name: 'currency',
		type: 'string',
		default: '',
		description: 'ISO 4217 currency code (e.g. EUR, USD)',
	},
	{
		displayName: 'Discount',
		name: 'discount',
		type: 'number',
		default: 0,
		description: 'Default discount percentage',
	},
	{
		displayName: 'Due Days',
		name: 'dueDays',
		type: 'number',
		default: 0,
		description: 'Default days until invoice is due',
	},
	{ displayName: 'Expenses Account', name: 'expensesAccount', type: 'string', default: '' },
	{ displayName: 'Language', name: 'language', type: 'string', default: '' },
	{
		displayName: 'Payment Day',
		name: 'paymentDay',
		type: 'number',
		default: 0,
		description: 'Fixed day of the month for payment',
	},
	{ displayName: 'Payment Method', name: 'paymentMethod', type: 'string', default: '' },
	{ displayName: 'Sales Channel', name: 'salesChannel', type: 'string', default: '' },
];

export const contactV2Operations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['contact'],
				apiVersion: ['v2'],
			},
		},
		options: [
			{
				name: 'Bulk Archive',
				value: 'bulkArchive',
				description: 'Archive multiple contacts at once',
				action: 'Archive contacts in bulk (V2)',
			},
			{
				name: 'Bulk Delete',
				value: 'bulkDelete',
				description: 'Permanently delete multiple contacts at once',
				action: 'Delete contacts in bulk (V2)',
			},
			{
				name: 'Create',
				value: 'create',
				description: 'Create a new contact',
				action: 'Create a contact (V2)',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a contact',
				action: 'Delete a contact (V2)',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a contact by ID',
				action: 'Get a contact (V2)',
			},
			{
				name: 'Get Attachment',
				value: 'getAttachment',
				description: 'Download a single attachment file from a contact',
				action: 'Get a contact attachment (V2)',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many contacts',
				action: 'Get many contacts (V2)',
			},
			{
				name: 'Get Portal Link',
				value: 'getPortalLink',
				description: 'Get the customer portal URL for a contact',
				action: 'Get the customer portal link (V2)',
			},
			{
				name: 'List Attachments',
				value: 'listAttachments',
				description: 'List every file attached to a contact',
				action: 'List contact attachments (V2)',
			},
			{
				name: 'Search',
				value: 'search',
				description: 'Search contacts by name (prefix match)',
				action: 'Search contacts (V2)',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update an existing contact (full replacement)',
				action: 'Update a contact (V2)',
			},
			{
				name: 'Upload Attachment',
				value: 'uploadAttachment',
				description: 'Attach a file (from a previous node\'s binary output) to a contact',
				action: 'Upload an attachment to a contact (V2)',
			},
		],
		default: 'getAll',
	},
];

export const contactV2Fields: INodeProperties[] = [
	// ---------- create ----------
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: { resource: ['contact'], apiVersion: ['v2'], operation: ['create'] },
		},
		description: 'Display name of the contact (person or company)',
	},
	{
		displayName: 'Type',
		name: 'type',
		type: 'options',
		default: 'client',
		displayOptions: {
			show: { resource: ['contact'], apiVersion: ['v2'], operation: ['create'] },
		},
		options: TYPE_OPTIONS,
		description: 'Role of this contact in your accounting',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: {
			show: { resource: ['contact'], apiVersion: ['v2'], operation: ['create'] },
		},
		options: [
			{
				displayName: 'Code',
				name: 'code',
				type: 'string',
				default: '',
				description: 'Internal reference code',
			},
			{
				displayName: 'Custom Fields (JSON)',
				name: 'customFieldsJson',
				type: 'json',
				default: '[]',
				description:
					'Array of { field, value } objects. Mapped to custom_fields[] on the request.',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
			},
			{
				displayName: 'Is Person',
				name: 'isPerson',
				type: 'boolean',
				default: false,
				description: 'Whether the contact is an individual (true) or a company (false)',
			},
			{ displayName: 'Mobile', name: 'mobile', type: 'string', default: '' },
			{ displayName: 'Phone', name: 'phone', type: 'string', default: '' },
			{
				displayName: 'Trade Name',
				name: 'tradeName',
				type: 'string',
				default: '',
				description: 'Commercial name if different from the legal name',
			},
			{
				displayName: 'VAT Number',
				name: 'vatNumber',
				type: 'string',
				default: '',
				description: 'EU VAT number for intra-community operations',
			},
			{
				displayName: 'Website',
				name: 'website',
				type: 'string',
				default: '',
			},
		],
	},
	{
		displayName: 'Billing Address',
		name: 'billAddress',
		type: 'fixedCollection',
		default: {},
		typeOptions: { multipleValues: false },
		placeholder: 'Add Billing Address',
		displayOptions: {
			show: { resource: ['contact'], apiVersion: ['v2'], operation: ['create', 'update'] },
		},
		options: [
			{
				displayName: 'Address Fields',
				name: 'value',
				values: BILL_ADDRESS_FIELDS,
			},
		],
	},
	{
		displayName: 'Defaults',
		name: 'defaults',
		type: 'fixedCollection',
		default: {},
		typeOptions: { multipleValues: false },
		placeholder: 'Add Defaults',
		displayOptions: {
			show: { resource: ['contact'], apiVersion: ['v2'], operation: ['create', 'update'] },
		},
		options: [
			{
				displayName: 'Default Fields',
				name: 'value',
				values: DEFAULTS_FIELDS,
			},
		],
	},

	// ---------- get / update / delete / attachments / portal-link: id ----------
	{
		displayName: 'Contact ID',
		name: 'contactId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contact'],
				apiVersion: ['v2'],
				operation: [
					'get',
					'update',
					'delete',
					'getAttachment',
					'getPortalLink',
					'listAttachments',
					'uploadAttachment',
				],
			},
		},
		description: 'Holded internal ID of the contact (24-char hex ObjectId)',
	},
	{
		displayName: 'Filename',
		name: 'filename',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: { resource: ['contact'], apiVersion: ['v2'], operation: ['getAttachment'] },
		},
		description: 'Exact filename of the attachment to download (as returned by List Attachments)',
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		displayOptions: {
			show: { resource: ['contact'], apiVersion: ['v2'], operation: ['uploadAttachment'] },
		},
		description:
			'Name of the binary property on the incoming item that contains the file to upload (multipart/form-data field "file")',
	},

	// ---------- update fields ----------
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: { resource: ['contact'], apiVersion: ['v2'], operation: ['update'] },
		},
		description:
			'Name of the contact. Required because v2 update is a full replacement (PUT), not a partial patch.',
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: {
			show: { resource: ['contact'], apiVersion: ['v2'], operation: ['update'] },
		},
		options: [
			{ displayName: 'Code', name: 'code', type: 'string', default: '' },
			{
				displayName: 'Custom Fields (JSON)',
				name: 'customFieldsJson',
				type: 'json',
				default: '[]',
				description: 'Array of { field, value } objects',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
			},
			{
				displayName: 'Is Person',
				name: 'isPerson',
				type: 'boolean',
				default: false,
			},
			{ displayName: 'Mobile', name: 'mobile', type: 'string', default: '' },
			{ displayName: 'Phone', name: 'phone', type: 'string', default: '' },
			{ displayName: 'Trade Name', name: 'tradeName', type: 'string', default: '' },
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				default: 'client',
				options: TYPE_OPTIONS,
			},
			{ displayName: 'VAT Number', name: 'vatNumber', type: 'string', default: '' },
			{ displayName: 'Website', name: 'website', type: 'string', default: '' },
		],
	},

	// ---------- getAll: pagination + filters ----------
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: { resource: ['contact'], apiVersion: ['v2'], operation: ['getAll', 'search'] },
		},
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: {
			show: {
				resource: ['contact'],
				apiVersion: ['v2'],
				operation: ['getAll', 'search'],
				returnAll: [false],
			},
		},
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: {
			show: { resource: ['contact'], apiVersion: ['v2'], operation: ['getAll'] },
		},
		options: [
			{
				displayName: 'Code',
				name: 'code',
				type: 'string',
				default: '',
				description: 'Exact match against the tax ID (NIF / CIF)',
			},
			{
				displayName: 'Custom ID',
				name: 'customId',
				type: 'string',
				default: '',
				description: 'Exact match against your external reference identifier',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
				description: 'Exact email match',
			},
			{
				displayName: 'Mobile',
				name: 'mobile',
				type: 'string',
				default: '',
				description: 'Exact mobile match',
			},
			{
				displayName: 'Phone',
				name: 'phone',
				type: 'string',
				default: '',
				description: 'Exact phone match',
			},
		],
	},

	// ---------- search ----------
	{
		displayName: 'Name',
		name: 'searchName',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: { resource: ['contact'], apiVersion: ['v2'], operation: ['search'] },
		},
		description:
			'Search term matched as a prefix against the contact name. Token-aware, case- and diacritic-insensitive.',
	},

	// ---------- bulk archive / bulk delete ----------
	{
		displayName: 'Contact IDs',
		name: 'contactIds',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contact'],
				apiVersion: ['v2'],
				operation: ['bulkArchive', 'bulkDelete'],
			},
		},
		description:
			'Comma-separated list of contact IDs. Each must be a 24-char hex ObjectId. Non-existent IDs are silently skipped; IDs from a different account fail the whole request with 400.',
	},
];
