const { pool } = require('../db');

const ALLOWED_UNITS = new Set(['kg', 'litro', 'unidad']);

function normalizeText(value, { required = false, field = 'campo', max = null } = {}) {
  if (value == null) {
    if (required) {
      const err = new Error(`El campo ${field} es obligatorio.`);
      err.status = 400;
      throw err;
    }
    return null;
  }
  const v = String(value).trim();
  if (!v) {
    if (required) {
      const err = new Error(`El campo ${field} es obligatorio.`);
      err.status = 400;
      throw err;
    }
    return null;
  }
  if (max && v.length > max) {
    const err = new Error(`El campo ${field} no puede superar ${max} caracteres.`);
    err.status = 400;
    throw err;
  }
  return v;
}

function normalizeUnit(value, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  const v = String(value || '').trim().toLowerCase();
  if (!ALLOWED_UNITS.has(v)) {
    const err = new Error("unit debe ser uno de: kg, litro, unidad.");
    err.status = 400;
    throw err;
  }
  return v;
}

function normalizeActiveFilter(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v || v === 'all') return 'all';
  if (v === 'true') return true;
  if (v === 'false') return false;
  const err = new Error('El filtro active debe ser true, false o all.');
  err.status = 400;
  throw err;
}

async function ensureCategoryExists(categoryId) {
  const res = await pool.query(
    `SELECT id, is_active
     FROM inventory_categories
     WHERE id = $1`,
    [categoryId]
  );
  const row = res.rows[0];
  if (!row || !row.is_active) {
    const err = new Error('Categoría no encontrada o inactiva.');
    err.status = 409;
    throw err;
  }
}

async function resolveBrandId({ clientId, userId, brandId, brandName }) {
  const normalizedBrandId = normalizeText(brandId);
  const normalizedBrandName = normalizeText(brandName, { max: 100 });

  if (normalizedBrandId) {
    const res = await pool.query(
      `SELECT id
       FROM inventory_brands
       WHERE id = $1
         AND client_id = $2`,
      [normalizedBrandId, clientId]
    );
    if (!res.rows[0]) {
      const err = new Error('Marca no encontrada.');
      err.status = 409;
      throw err;
    }
    return normalizedBrandId;
  }

  if (!normalizedBrandName) return null;

  const existing = await pool.query(
    `SELECT id
     FROM inventory_brands
     WHERE client_id = $1
       AND lower(trim(name)) = lower(trim($2))
     LIMIT 1`,
    [clientId, normalizedBrandName]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  try {
    const inserted = await pool.query(
      `INSERT INTO inventory_brands (name, client_id, created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, $3, $3)
       RETURNING id`,
      [normalizedBrandName, clientId, userId]
    );
    return inserted.rows[0].id;
  } catch (e) {
    if (e.code === '23505') {
      const afterConflict = await pool.query(
        `SELECT id
         FROM inventory_brands
         WHERE client_id = $1
           AND lower(trim(name)) = lower(trim($2))
         LIMIT 1`,
        [clientId, normalizedBrandName]
      );
      if (afterConflict.rows[0]) return afterConflict.rows[0].id;
    }
    throw e;
  }
}

async function assertUniqueItem({ clientId, name, unit, brandId, excludeId = null }) {
  const res = await pool.query(
    `SELECT id
     FROM inventory_items
     WHERE client_id = $1
       AND lower(trim(name)) = lower(trim($2))
       AND lower(trim(unit)) = lower(trim($3))
       AND brand_id IS NOT DISTINCT FROM $4::uuid
       AND ($5::uuid IS NULL OR id <> $5::uuid)
     LIMIT 1`,
    [clientId, name, unit, brandId || null, excludeId]
  );
  if (res.rows[0]) {
    const err = new Error('Ya existe un insumo con el mismo nombre, unidad y fabricante.');
    err.status = 409;
    throw err;
  }
}

async function listInventoryItems({ clientId, active, categoryId, search }) {
  const normalizedActive = normalizeActiveFilter(active);
  const normalizedCategory = normalizeText(categoryId);
  const normalizedSearch = String(search || '').trim().toLowerCase();
  const like = normalizedSearch ? `%${normalizedSearch}%` : null;

  const res = await pool.query(
    `SELECT i.id, i.name, i.unit, i.category_id, i.brand_id, i.is_active, i.created_at, i.updated_at,
            c.name AS category_name,
            b.name AS brand_name
     FROM inventory_items i
     JOIN inventory_categories c ON c.id = i.category_id
     LEFT JOIN inventory_brands b ON b.id = i.brand_id AND b.client_id = i.client_id
     WHERE i.client_id = $1
       AND ($2::text = 'all' OR i.is_active = $2::boolean)
       AND ($3::uuid IS NULL OR i.category_id = $3::uuid)
       AND (
         $4::text IS NULL
         OR lower(i.name) LIKE $4
         OR lower(i.unit) LIKE $4
         OR lower(c.name) LIKE $4
         OR lower(COALESCE(b.name, '')) LIKE $4
       )
     ORDER BY i.is_active DESC, i.name ASC`,
    [clientId, normalizedActive, normalizedCategory, like]
  );
  return res.rows;
}

async function getInventoryItemById({ clientId, id }) {
  const res = await pool.query(
    `SELECT i.id, i.name, i.unit, i.category_id, i.brand_id, i.is_active, i.created_at, i.updated_at,
            c.name AS category_name,
            b.name AS brand_name
     FROM inventory_items i
     JOIN inventory_categories c ON c.id = i.category_id
     LEFT JOIN inventory_brands b ON b.id = i.brand_id AND b.client_id = i.client_id
     WHERE i.client_id = $1
       AND i.id = $2`,
    [clientId, id]
  );
  return res.rows[0] || null;
}

async function createInventoryItem({
  clientId,
  userId,
  name,
  unit,
  categoryId,
  brandId,
  brandName,
}) {
  const cleanName = normalizeText(name, { required: true, field: 'name', max: 150 });
  const cleanUnit = normalizeUnit(unit, { required: true });
  const cleanCategoryId = normalizeText(categoryId, { required: true, field: 'category_id' });
  await ensureCategoryExists(cleanCategoryId);
  const resolvedBrandId = await resolveBrandId({
    clientId,
    userId,
    brandId,
    brandName,
  });

  await assertUniqueItem({
    clientId,
    name: cleanName,
    unit: cleanUnit,
    brandId: resolvedBrandId,
  });

  const res = await pool.query(
    `INSERT INTO inventory_items (
       name, unit, category_id, brand_id, client_id, created_by_user_id, updated_by_user_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     RETURNING id, name, unit, category_id, brand_id, is_active, created_at, updated_at`,
    [cleanName, cleanUnit, cleanCategoryId, resolvedBrandId, clientId, userId]
  );
  return getInventoryItemById({ clientId, id: res.rows[0].id });
}

async function updateInventoryItem({
  clientId,
  userId,
  id,
  name,
  unit,
  categoryId,
  brandId,
  brandName,
}) {
  const current = await getInventoryItemById({ clientId, id });
  if (!current) return null;

  const nextName =
    name !== undefined ? normalizeText(name, { required: true, field: 'name', max: 150 }) : current.name;
  const nextUnit = unit !== undefined ? normalizeUnit(unit, { required: true }) : current.unit;
  const nextCategoryId =
    categoryId !== undefined
      ? normalizeText(categoryId, { required: true, field: 'category_id' })
      : current.category_id;
  await ensureCategoryExists(nextCategoryId);

  const hasBrandFields = brandId !== undefined || brandName !== undefined;
  const nextBrandId = hasBrandFields
    ? await resolveBrandId({
        clientId,
        userId,
        brandId,
        brandName,
      })
    : current.brand_id;

  await assertUniqueItem({
    clientId,
    name: nextName,
    unit: nextUnit,
    brandId: nextBrandId,
    excludeId: id,
  });

  const fields = [];
  const values = [];
  let idx = 1;

  if (name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(nextName);
  }
  if (unit !== undefined) {
    fields.push(`unit = $${idx++}`);
    values.push(nextUnit);
  }
  if (categoryId !== undefined) {
    fields.push(`category_id = $${idx++}`);
    values.push(nextCategoryId);
  }
  if (hasBrandFields) {
    fields.push(`brand_id = $${idx++}`);
    values.push(nextBrandId);
  }

  if (!fields.length) {
    const err = new Error('No hay cambios para actualizar.');
    err.status = 400;
    throw err;
  }

  fields.push(`updated_by_user_id = $${idx++}`);
  values.push(userId);
  fields.push(`updated_at = NOW()`);
  values.push(id);
  values.push(clientId);

  await pool.query(
    `UPDATE inventory_items
     SET ${fields.join(', ')}
     WHERE id = $${idx++}
       AND client_id = $${idx}`,
    values
  );
  return getInventoryItemById({ clientId, id });
}

async function setInventoryItemActive({ clientId, userId, id, isActive }) {
  const res = await pool.query(
    `UPDATE inventory_items
     SET is_active = $2,
         updated_by_user_id = $3,
         updated_at = NOW()
     WHERE id = $1
       AND client_id = $4
     RETURNING id`,
    [id, !!isActive, userId, clientId]
  );
  if (!res.rows[0]) return null;
  return getInventoryItemById({ clientId, id });
}

async function getInventoryItemsMeta({ clientId }) {
  if (!clientId) {
    const err = new Error('Tu usuario no tiene un cliente asignado.');
    err.status = 403;
    throw err;
  }
  const [categories, brands] = await Promise.all([
    pool.query(
      `SELECT id, name
       FROM inventory_categories
       WHERE is_active = true
       ORDER BY name ASC`
    ),
    pool.query(
      `SELECT id, name
       FROM inventory_brands
       WHERE client_id = $1
         AND is_active = true
       ORDER BY name ASC`,
      [clientId]
    ),
  ]);
  return { categories: categories.rows, brands: brands.rows, units: ['kg', 'litro', 'unidad'] };
}

module.exports = {
  listInventoryItems,
  getInventoryItemById,
  createInventoryItem,
  updateInventoryItem,
  setInventoryItemActive,
  getInventoryItemsMeta,
};

