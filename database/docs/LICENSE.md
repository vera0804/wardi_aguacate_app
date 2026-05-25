# Licencias por organización (Wardi Café)

La vigencia vive en `clients`, ligada al `plan_id` y a `plans.billing_model`. El backend calcula fechas, valida en login y en cada request, y un cron nocturno marca vencidos y revoca sesiones.

## Migraciones

| Archivo | Uso |
|---------|-----|
| `migrations/20260521170000_client_license_plans.sql` | Columnas + seed Plan Demo |
| `migrations/20260521181000_client_license_plans_reapply.sql` | Idempotente si 170000 era versión corta |
| `scripts/rollback_client_license_plans.sql` | **Manual**: deshace 170000; luego `DELETE` en `schema_migrations` y `npm run db:migrate` |

```bash
cd api
npm run db:migrate
node ../database/verify-migrations.js
```

## Modelos de facturación (`plans.billing_model`)

| Modelo | `license_expires_on` |
|--------|----------------------|
| `perpetual` | `NULL` (sin vencimiento) |
| `trial_days` | inicio + N días (`trial_days` u override al crear/renovar) |
| `monthly_anchor` | mismo día del mes siguiente (`billing_anchor_day` 1–28) |

Cálculo: `api/src/lib/licenseDates.js`.

## Backend

| Archivo | Rol |
|---------|-----|
| `client-license.service.js` | `clientLicenseRowToMeta`, cron, revocar sesiones |
| `superadmin.service.js` | `buildLicenseFieldsFromPlan`, alta y renovación |
| `auth.service.js` | login + perfil `/me` |
| `auth.middleware.js` | `requireAuth` |
| `jobs/license-expiry.cron.js` | 23:59 (`LICENSE_TIMEZONE`, `LICENSE_CRON_*`) |

## API superadmin

- `GET /api/superadmin/plans` — planes activos (límites, precio, `billing_model`, `description`)
- `GET /api/superadmin/plans/all` — todos los planes + `active_client_count`
- `GET /api/superadmin/plans/:id/impact` — organizaciones activas afectadas
- `POST` / `PATCH` / `POST .../deactivate` — CRUD; editar/inactivar exige `acknowledge_affected_clients` si hay clientes activos
- PWA: pestañas **Organizaciones** y **Planes** (`/superadmin/plans`)
- `GET /api/superadmin/clients` — fechas ISO + `license_expires_on_display`
- `POST /api/superadmin/clients` — `plan_id`, `license_starts_on`, `billing_anchor_day`, `trial_days_override`
- `POST /api/superadmin/clients/:id/license/renew`

## Perfil y UI

- `GET /api/auth/me`: `licenseExpiresOn`, `licenseExpiresOnDisplay`, `licenseValid`
- PWA superadmin: tarjeta de características del plan (`SuperadminPlanSummary`)
- PWA admin: pie en `DashboardShell` (solo `isTenantAdmin` y con fecha)
- Login: `LICENSE_EXPIRED` → «Licencia vencida»

## Variables de entorno

```env
LICENSE_TIMEZONE=America/Costa_Rica
LICENSE_CRON_SCHEDULE=59 23 * * *
LICENSE_CRON_ENABLED=1
```

## Clientes antiguos

`license_expires_on IS NULL` → sin vencimiento hasta renovación o alta con plan acotado.

## Límites vs licencia

- **Licencia**: ¿puede usar el sistema? (`status`, fechas, auth, cron)
- **Límites del plan**: fincas/usuarios mientras la licencia esté vigente (`client-plan-limits.service.js`)
