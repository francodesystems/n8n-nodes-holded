# Holded API v2 — Contacts spec (extracted from developers portal)

> Fuente: https://www.holded.com/es/desarrolladores/referencia-api/contactos/*
> Capturado: 2026-06-03 con Playwright contra el SPA del portal (no hay openapi.json descargable público).
> Cobertura: 8 ops core para v0.2.0. Faltan 4 ops (adjuntos + portal de cliente) que dejamos para v0.3.0.

## Fundación de la API v2

### Base URL
```
https://api.holded.com/api/v2
```

### Autenticación
Bearer token estándar:
```
Authorization: Bearer YOUR_API_KEY
```
La clave se obtiene en el panel de Holded: **Ajustes → API → Generar nueva clave**.

> Cambio vs v1: v1 usaba el header `key: <api_key>`. v2 es `Authorization: Bearer <api_key>` estándar OAuth 2.0 — implica nuevo `HoldedApiV2.credentials.ts` que NO puede reusar el authenticator de v1.

### Scopes
Cada endpoint declara un scope tipo `<area>:<recurso>.<acción>`.
- Contactos read: `contacts:contacts.read`
- Contactos write: `contacts:contacts.write`

Si la clave no tiene el scope → `403 Forbidden`.

### Paginación (cursor)
Endpoints de listado responden:
```json
{
  "items": [ ... ],
  "cursor": "opaque-string",
  "has_more": false
}
```
Query params:
- `limit` — default `25`, máximo `100`
- `cursor` — string opaco devuelto en la respuesta anterior

Bucle canónico: usar `has_more` (no `cursor != null`), pasando `cursor` en la siguiente petición hasta `has_more === false`.

### Errores (RFC 7807)
```json
{
  "type": "https://api.holded.com/problems/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "The requested invoice was not found."
}
```
Códigos: `400` bad request · `401` unauthorized · `403` forbidden (scope) · `404` not found · `422` validación · `429` rate limit · `500` server.

### Rate limit
100 req/min por API key. Excede → `429`.

---

## Endpoints de Contact (12 totales — 8 en v0.2.0)

### 1. Crear un contacto — `POST /contacts`
Scope: `contacts:contacts.write` · Respuesta: `201` con `{ id: string }`

**Body:**
| Campo | Tipo | Req | Notas |
|---|---|---|---|
| `name` | string | ✓ | Nombre del contacto |
| `code` | string \| null | | Código de referencia interno (lo que en v1 era el NIF/CIF) |
| `vat_number` | string \| null | | NIF/CIF — campo nuevo separado del code |
| `trade_name` | string \| null | | Nombre comercial |
| `is_person` | boolean | | true persona física, false empresa |
| `email` | string \| null | | |
| `phone` | string \| null | | |
| `mobile` | string \| null | | |
| `website` | string \| null | | |
| `type` | enum \| null | | `client` \| `debtor` \| `supplier` \| `creditor` \| `lead` |
| `bill_address` | object \| null | | Ver sub-schema abajo |
| `custom_fields[]` | `{field, value}[]` | | |
| `defaults` | object \| null | | Ver sub-schema abajo |

**`bill_address` sub-schema:**
`address`, `city`, `postal_code`, `province`, `country`, `country_code` (ISO 3166-1 alpha-2), `info`.

**`defaults` sub-schema:**
`sales_channel`, `expenses_account`, `due_days` (int), `payment_day` (int), `payment_method`, `discount` (int %), `language`, `currency` (ISO 4217), `sales_tax` (object), `purchases_tax` (object).

---

### 2. Obtener un contacto por ID — `GET /contacts/{contactId}`
Scope: `contacts:contacts.read` · Respuesta: `200` con objeto Contact completo.

**Path params:** `contactId` (ObjectId hex 24 chars).

**Forma completa del recurso Contact (response):**
Además de los campos del body de creación, la respuesta incluye:
- `custom_id` (string \| null) — referencia externa (la que setea tu integración)
- `iban`, `swift`
- `group_id` (ref grupo de contactos)
- `tags[]` (string[])
- `created_at`, `updated_at` (date-time ISO)
- `client_record` / `supplier_record` — `{ num: int, name: string }` (cuentas contables)
- `shipping_addresses[]` — array de direcciones con `shipping_id` + campos de address + `notes` + `private_notes`
- `notes[]` — `{ note_id, name, description, color, updated_at }`
- `contact_persons[]` — `{ person_id, name, job, phone, email, send_documents_by_default }`
- `extra_emails[]` (string[])
- `social_networks` (object)
- `rate` — `{ id, name, description }` (tarifa asignada)

---

### 3. Listado de contactos — `GET /contacts`
Scope: `contacts:contacts.read` · Respuesta paginada `{ items, cursor, has_more }`.

**Query params:**
| Param | Tipo | Notas |
|---|---|---|
| `phone` | string | Match exacto |
| `mobile` | string | Match exacto |
| `email` | string | Match exacto |
| `custom_id` | string | Match exacto |
| `code` | string | Match exacto (NIF/CIF) |
| `cursor` | string | Paginación |
| `limit` | int | Default 25, max 100 |

> Nota: NO hay filtro `type` ni `name` en list (a diferencia de v1). Para buscar por nombre usar el endpoint `/contacts/search` específico. Hay un filtro `archived` implícito mencionado en la doc de bulk-archive ("se pueden recuperar con el filtro `archived`") pero no estaba documentado en el listado — verificar en pruebas reales.

---

### 4. Actualizar un contacto — `PUT /contacts/{contactId}`
Scope: `contacts:contacts.write` · Respuesta: `200` con `{ status: 1 }`.

⚠️ Es PUT — reemplazo completo. `name` sigue siendo required. Si el caller solo quiere cambiar un campo, **debe hacer GET previo, mergear, y mandar el objeto completo**. No hay PATCH.

Body: igual que Crear, más `contact_persons[]: [{ person_id }]` para vincular personas existentes.

---

### 5. Eliminar un contacto — `DELETE /contacts/{contactId}`
Scope: `contacts:contacts.write` · Respuesta: `204` No Content.

Borrado permanente. Documentos vinculados conservan el nombre del contacto para mostrar, pero pierden la asociación activa.

---

### 6. Buscar contactos por nombre — `GET /contacts/search`
Scope: `contacts:contacts.read` · Respuesta paginada.

**Query params:**
- `name` (string, required) — prefijo, sensible a tokens, insensible a mayúsculas/diacríticos. `name=Joh` matches `John Due`, `John Smith`, etc.
- `cursor`, `limit` (paginación estándar)

---

### 7. Archivar contactos en bloque — `POST /contacts/bulk-archive`
Scope: `contacts:contacts.write` · Respuesta: `204`.

Body: `{ contact_ids: string[] }`. Ya archivados/inexistentes se ignoran silenciosamente. Si algún ID pertenece a otra cuenta → `400`.

---

### 8. Eliminar contactos en bloque — `POST /contacts/bulk-delete`
Scope: `contacts:contacts.write` · Respuesta: `204`.

Body: `{ contact_ids: string[] }`. Mismo manejo que bulk-archive. Acción permanente.

---

## Pendiente para v0.3.0+ (capturados como slugs)

- `POST /contacts/{contactId}/attachments` — Adjuntar un archivo
- `GET /contacts/{contactId}/attachments` — Listar adjuntos
- `GET /contacts/{contactId}/attachments/{attachmentId}` — Obtener adjunto
- `GET /contacts/{contactId}/portal-link` — Enlace del portal de cliente (slug exacto pendiente de confirmar)

Recursos relacionados (recurso aparte, no Contact):
- `grupos-de-contactos` — 5 ops CRUD
- `etiquetas` — 3 ops (crear, listar, eliminar)

---

## Diferencias clave v1 → v2 (resumen para migración)

| Aspecto | v1 | v2 |
|---|---|---|
| Base URL | `api.holded.com/api/invoicing/v1/contacts` | `api.holded.com/api/v2/contacts` |
| Auth header | `key: <api_key>` | `Authorization: Bearer <api_key>` |
| Convención de campos | camelCase mezclado (`isperson`, `tradeName`) | snake_case estricto (`is_person`, `trade_name`) |
| NIF/CIF | `code` | `code` + `vat_number` (separados) |
| Dirección facturación | Campos planos top-level | Objeto anidado `bill_address` |
| Defaults del contacto | Campos planos top-level | Objeto anidado `defaults` |
| Paginación | `page` + `limit` (offset) | `cursor` + `limit` |
| Búsqueda por nombre | `?name=` en list | Endpoint separado `/contacts/search` |
| Actualización | PUT, devuelve objeto completo | PUT, devuelve `{ status: 1 }` (hay que re-GET si quieres el objeto resultante) |
| Bulk ops | Inexistentes | `bulk-archive`, `bulk-delete` |
| Errores | Texto ad-hoc por endpoint | RFC 7807 (`type`/`title`/`status`/`detail`) |
| Rate limit | No documentado | 100 req/min por key, 429 al exceder |
