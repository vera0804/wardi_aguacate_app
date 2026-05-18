# Proyecto Base (actualizado)

Documento de referencia para replicar un proyecto similar a `cafe-don-cecilio-app` con la arquitectura y stack que usa hoy.

## 1) Resumen técnico

- **Tipo de proyecto:** monorepo JavaScript (frontend + backend + SQL).
- **Frontend:** React 19 + Vite 7 + TailwindCSS 4 + PWA (`vite-plugin-pwa`).
- **Backend:** Node.js + Express 5 (CommonJS) + PostgreSQL (`pg`).
- **Base de datos:** PostgreSQL con scripts de esquema y migraciones SQL.
- **Mapas:** Mapbox GL, Leaflet y herramientas de dibujo.
- **Gráficos/reportes:** Recharts.
- **Auth/sesión:** cookies + CSRF middleware + control de roles.
- **Despliegue principal:** Railway (mismo dominio para PWA y API, con `/api`).

## 2) Estructura actual de carpetas

```text
cafe-don-cecilio-app/
├─ api/
│  ├─ src/
│  │  ├─ index.js
│  │  ├─ app.js
│  │  ├─ db.js
│  │  ├─ middleware/
│  │  ├─ routes/
│  │  ├─ services/
│  │  └─ sql/
│  ├─ test/
│  ├─ package.json
│  └─ package-lock.json
├─ pwa/
│  ├─ public/
│  │  ├─ icons/
│  │  └─ images/
│  ├─ src/
│  │  ├─ pages/
│  │  ├─ components/
│  │  ├─ layouts/
│  │  ├─ offline/
│  │  ├─ services/
│  │  ├─ hooks/
│  │  ├─ auth/
│  │  └─ utils/
│  ├─ vite.config.js
│  ├─ package.json
│  └─ package-lock.json
├─ database/
│  ├─ schema.sql
│  ├─ cafe_don_cecilio.sql
│  └─ migrations/
├─ scripts/
│  └─ copy-pwa.js
├─ DEPLOY.md
├─ DEPLOY-RAILWAY.md
└─ package.json
```

## 3) Lenguaje y patrones

- **Lenguaje principal:** JavaScript (sin TypeScript).
- **Frontend:**
  - React con componentes funcionales y hooks.
  - Ruteo con `react-router-dom`.
  - UI con utilidades Tailwind.
  - Módulo `offline/` para soporte offline y cola de sincronización.
- **Backend:**
  - API REST organizada por dominio en `api/src/routes`.
  - Servicios de negocio en `api/src/services`.
  - Middlewares de seguridad/autorización/CSRF.
  - Conexión DB centralizada en `api/src/db.js`.

## 4) Interfaz y módulos funcionales

- Dashboard y navegación por módulos agrícolas.
- Gestión operativa:
  - Fincas, lotes, cosechas, trabajadores, tipos de labor, cronograma.
  - Producción por lote y registro de labores.
  - Inventario: categorías, marcas, insumos, movimientos, consumos, stock.
  - Gastos, activos y planilla fija.
- Reportería amplia en `pwa/src/pages` (costos, producción, rentabilidad, inventario).
- Mapas en módulos geográficos (`FarmMap`, `LotMap`, reportes de productividad).
- Roles visibles en el proyecto: `admin`, `operario`, `tecnico`.

## 5) Dependencias clave

### Frontend (`pwa/package.json`)

- `react`, `react-dom`
- `vite`, `@vitejs/plugin-react`
- `tailwindcss`, `@tailwindcss/vite`
- `vite-plugin-pwa`
- `react-router-dom`
- `mapbox-gl`, `leaflet`, `react-leaflet`, `@mapbox/mapbox-gl-draw`, `leaflet-draw`
- `recharts`

### Backend (`api/package.json`)

- `express`, `pg`
- `dotenv`, `cors`, `helmet`, `cookie-parser`
- `bcrypt`
- `axios`, `xml2js`, `resend`
- `nodemon` (desarrollo)

## 6) Requisitos para levantarlo bien

- **Node.js:** recomendado LTS actual (ideal Node 20+).
- **npm:** incluido con Node.
- **PostgreSQL:** instancia disponible y accesible.
- **Variables de entorno mínimas backend:**
  - `DATABASE_URL`
  - `SESSION_SECRET`
  - `CORS_ORIGIN` (si frontend y backend no comparten origen en dev)
  - `PORT` (opcional, por defecto 3000)
  - `NODE_ENV` (opcional)
- **Variables útiles frontend:**
  - `VITE_API_URL` (en local normalmente `http://localhost:3000/api`)
  - `VITE_MAPBOX_TOKEN` (si se usan mapas Mapbox)

## 7) Instalación y ejecución local

### Opción A: backend y frontend por separado (desarrollo)

1. Instalar backend:
   - `cd api`
   - `npm ci`
2. Levantar API:
   - `npm run dev`
3. En otra terminal, instalar frontend:
   - `cd pwa`
   - `npm ci`
4. Levantar PWA:
   - `npm run dev`

### Opción B: build integrado (mismo dominio)

Desde la raíz:

1. `npm run build`
2. `npm start`

Esto compila `pwa`, copia `pwa/dist` a `api/public` (script `scripts/copy-pwa.js`) y sirve todo desde el backend.

## 8) Scripts raíz importantes

En `package.json` (raíz):

- `npm run install` -> instala dependencias de `api`.
- `npm run build` -> build de `pwa` con `VITE_API_URL=/api` y copia a `api/public`.
- `npm start` -> arranca `api/src/index.js`.

## 9) Base de datos

Carpeta `database/`:

- `schema.sql`: estructura base.
- `cafe_don_cecilio.sql`: dump/script adicional de referencia.
- `migrations/`: cambios incrementales.

Recomendación para clonar un proyecto similar:

1. Crear DB PostgreSQL vacía.
2. Ejecutar `schema.sql`.
3. Ejecutar migraciones en orden cronológico.
4. Configurar `DATABASE_URL` y arrancar API.

## 10) Deploy recomendado (Railway)

- Monorepo con root en la carpeta principal.
- Build: `npm run build`
- Start: `npm start`
- API y PWA en el mismo dominio.
- Endpoint API en `/api`.
- Ver detalles prácticos en `DEPLOY.md` y `DEPLOY-RAILWAY.md`.

---

Si vas a crear un proyecto nuevo similar, usa esta misma separación (`api/`, `pwa/`, `database/`) y replica primero autenticación, permisos, catálogo base (finca/lote/cosecha/trabajador), luego inventario, producción y reportes.
