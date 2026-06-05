import type { INodeProperties } from 'n8n-workflow';

export const contactOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['contact'],
				apiVersion: ['v1'],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a new contact',
				action: 'Create a contact (V1)',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a contact',
				action: 'Delete a contact (V1)',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a contact by ID',
				action: 'Get a contact (V1)',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many contacts',
				action: 'Get many contacts (V1)',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update an existing contact',
				action: 'Update a contact (V1)',
			},
		],
		default: 'getAll',
	},
];

export const contactFields: INodeProperties[] = [
	// ---------- create ----------
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: { resource: ['contact'], apiVersion: ['v1'], operation: ['create'] },
		},
		description: 'Display name of the contact (person or company)',
	},
	{
		displayName: 'Type',
		name: 'type',
		type: 'options',
		default: 'client',
		displayOptions: {
			show: { resource: ['contact'], apiVersion: ['v1'], operation: ['create'] },
		},
		options: [
			{ name: 'Client', value: 'client' },
			{ name: 'Creditor', value: 'creditor' },
			{ name: 'Debtor', value: 'debtor' },
			{ name: 'Lead', value: 'lead' },
			{ name: 'Supplier', value: 'supplier' },
		],
		description: 'Role of this contact in your accounting',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: {
			show: { resource: ['contact'], apiVersion: ['v1'], operation: ['create'] },
		},
		options: [
			{
				displayName: 'Code',
				name: 'code',
				type: 'string',
				default: '',
				description: 'Internal code / reference for this contact',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
			},
			{
				displayName: 'IBAN',
				name: 'iban',
				type: 'string',
				default: '',
			},
			{
				displayName: 'Is Person',
				name: 'isperson',
				type: 'options',
				default: 0,
				options: [
					{ name: 'Company', value: 0 },
					{ name: 'Person', value: 1 },
				],
			},
			{
				displayName: 'Mobile',
				name: 'mobile',
				type: 'string',
				default: '',
			},
			{
				displayName: 'Phone',
				name: 'phone',
				type: 'string',
				default: '',
			},
			{
				displayName: 'SWIFT',
				name: 'swift',
				type: 'string',
				default: '',
			},
			{
				displayName: 'Trade Name',
				name: 'tradeName',
				type: 'string',
				default: '',
			},
			{
				displayName: 'VAT Number',
				name: 'vatnumber',
				type: 'string',
				default: '',
				description: 'Tax identification number (NIF / CIF / VIES VAT ID)',
			},
		],
	},

	// ---------- get / update / delete: id ----------
	{
		displayName: 'Contact ID',
		name: 'contactId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['contact'],
				apiVersion: ['v1'],
				operation: ['get', 'update', 'delete'],
			},
		},
		description: 'Holded internal ID of the contact',
	},

	// ---------- update fields ----------
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: {
			show: { resource: ['contact'], apiVersion: ['v1'], operation: ['update'] },
		},
		options: [
			{ displayName: 'Code', name: 'code', type: 'string', default: '' },
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
			},
			{ displayName: 'IBAN', name: 'iban', type: 'string', default: '' },
			{ displayName: 'Mobile', name: 'mobile', type: 'string', default: '' },
			{ displayName: 'Name', name: 'name', type: 'string', default: '' },
			{ displayName: 'Phone', name: 'phone', type: 'string', default: '' },
			{ displayName: 'SWIFT', name: 'swift', type: 'string', default: '' },
			{ displayName: 'Trade Name', name: 'tradeName', type: 'string', default: '' },
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				default: 'client',
				options: [
					{ name: 'Client', value: 'client' },
					{ name: 'Creditor', value: 'creditor' },
					{ name: 'Debtor', value: 'debtor' },
					{ name: 'Lead', value: 'lead' },
					{ name: 'Supplier', value: 'supplier' },
				],
			},
			{ displayName: 'VAT Number', name: 'vatnumber', type: 'string', default: '' },
		],
	},

	// ---------- getAll: pagination ----------
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: { resource: ['contact'], apiVersion: ['v1'], operation: ['getAll'] },
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
				apiVersion: ['v1'],
				operation: ['getAll'],
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
			show: { resource: ['contact'], apiVersion: ['v1'], operation: ['getAll'] },
		},
		options: [
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				default: '',
				options: [
					{ name: 'Any', value: '' },
					{ name: 'Client', value: 'client' },
					{ name: 'Creditor', value: 'creditor' },
					{ name: 'Debtor', value: 'debtor' },
					{ name: 'Lead', value: 'lead' },
					{ name: 'Supplier', value: 'supplier' },
				],
			},
		],
	},
];
