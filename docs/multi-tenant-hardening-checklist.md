# Multi-Tenant Hardening Checklist

Checklist rapido para validar aislamiento de datos y consistencia luego de aplicar la migracion de `workers` y `labor_entries`.

## 0) Precondiciones

- API levantada.
- Migraciones aplicadas.
- Existen al menos 2 clientes (`client_a`, `client_b`) con usuarios activos.
- Tienes 2 sesiones autenticadas (una por cliente).

> Recomendado: usar `PORT=3002` si ese es tu backend de pruebas.

---

## 1) SQL - Sanidad de datos

Ejecutar en PostgreSQL:

```sql
-- 1.1 No deben quedar nulls de client_id
SELECT 'workers' AS table_name, COUNT(*) AS rows_with_null_client
FROM workers
WHERE client_id IS NULL
UNION ALL
SELECT 'labor_entries' AS table_name, COUNT(*) AS rows_with_null_client
FROM labor_entries
WHERE client_id IS NULL;

-- 1.2 Integridad de tenant: labor_entries vs worker
SELECT COUNT(*) AS mismatched_worker_client
FROM labor_entries le
JOIN workers w ON w.id = le.worker_id
WHERE le.client_id IS DISTINCT FROM w.client_id;

-- 1.3 Integridad de tenant: labor_entries vs lot
SELECT COUNT(*) AS mismatched_lot_client
FROM labor_entries le
JOIN lots l ON l.id = le.lot_id
WHERE le.lot_id IS NOT NULL
  AND le.client_id IS DISTINCT FROM l.client_id;

-- 1.4 Integridad de tenant: labor_entries vs farm
SELECT COUNT(*) AS mismatched_farm_client
FROM labor_entries le
JOIN farms f ON f.id = le.farm_id
WHERE le.farm_id IS NOT NULL
  AND le.client_id IS DISTINCT FROM f.client_id;

-- 1.5 Verificar indexes nuevos
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('idx_workers_client', 'idx_labor_entries_client');
```

Resultado esperado:

- `rows_with_null_client = 0` en ambas tablas.
- Todos los `mismatched_* = 0`.
- Existen ambos indices.

---

## 2) API - Aislamiento entre clientes (negativo)

> Usa dos cookies/sesiones: `cookieA` (cliente A) y `cookieB` (cliente B).

Primero toma IDs validos del cliente B:

```bash
curl -s "http://localhost:3002/api/workers?active=all" \
  -H "Cookie: ${cookieB}"

curl -s "http://localhost:3002/api/labor-entries?active=all" \
  -H "Cookie: ${cookieB}"
```

Con esos IDs (`workerB`, `laborEntryB`), intenta leer con cliente A:

```bash
curl -i -s "http://localhost:3002/api/workers/${workerB}" \
  -H "Cookie: ${cookieA}"

curl -i -s "http://localhost:3002/api/labor-entries/${laborEntryB}" \
  -H "Cookie: ${cookieA}"
```

Resultado esperado:

- `404 Not Found` en ambos endpoints.

Tambien prueba mutaciones cruzadas:

```bash
curl -i -s -X PATCH "http://localhost:3002/api/workers/${workerB}/active" \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: ${csrfA}" \
  -H "Cookie: ${cookieA}" \
  --data "{\"is_active\":false}"

curl -i -s -X PATCH "http://localhost:3002/api/labor-entries/${laborEntryB}/active" \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: ${csrfA}" \
  -H "Cookie: ${cookieA}" \
  --data "{\"is_active\":false}"
```

Resultado esperado:

- `404 Not Found` (no debe tocar registros de otro tenant).

---

## 3) API - FKs cruzadas (negativo)

Con sesion de cliente A, intenta crear labor usando `worker_id` o `lot_id/farm_id` del cliente B:

```bash
curl -i -s -X POST "http://localhost:3002/api/labor-entries" \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: ${csrfA}" \
  -H "Cookie: ${cookieA}" \
  --data "{
    \"cost_scope\":\"lot\",
    \"lot_id\":\"${lotB}\",
    \"worker_id\":\"${workerA}\",
    \"labor_type_id\":\"${laborTypeA}\",
    \"work_date\":\"2026-05-06\",
    \"unit\":\"hora\",
    \"qty\":1,
    \"rate_applied\":1000
  }"
```

Resultado esperado:

- `409` con mensaje de entidad no encontrada/inactiva (o equivalente de validacion).

---

## 4) API - Resumenes y meta por tenant

```bash
curl -s "http://localhost:3002/api/labor-entries/summary/lot?from_date=2026-01-01&to_date=2026-12-31" \
  -H "Cookie: ${cookieA}"

curl -s "http://localhost:3002/api/labor-entries/summary/worker?from_date=2026-01-01&to_date=2026-12-31" \
  -H "Cookie: ${cookieA}"

curl -s "http://localhost:3002/api/labor-entries/meta" \
  -H "Cookie: ${cookieA}"
```

Validar manualmente:

- No aparecen workers/fincas/lotes del cliente B.
- Totales de resumen solo reflejan entradas del cliente A.

Repetir con `cookieB` y verificar el aislamiento inverso.

---

## 5) SQL - Post pruebas

```sql
-- Confirmar que ninguna prueba cruzada modifico datos de otro tenant
SELECT client_id, COUNT(*) AS workers_count
FROM workers
GROUP BY client_id
ORDER BY client_id;

SELECT client_id, COUNT(*) AS labor_entries_count
FROM labor_entries
GROUP BY client_id
ORDER BY client_id;
```

Si quieres automatizar todo este checklist en un solo script (Node + asserts), se puede agregar en `scripts/smoke-multitenant.js`.
