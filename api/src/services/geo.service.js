const { pool } = require('../db');

async function listProvinces() {
  const res = await pool.query(
    `SELECT id, name, official_code
     FROM provinces
     ORDER BY name ASC`
  );
  return res.rows;
}

async function listCantonsByProvince(provinceId) {
  const pid = Number(provinceId);
  if (!Number.isInteger(pid) || pid <= 0) {
    const err = new Error('province_id inválido.');
    err.status = 400;
    throw err;
  }
  const res = await pool.query(
    `SELECT id, province_id, name, official_code
     FROM cantons
     WHERE province_id = $1
     ORDER BY name ASC`,
    [pid]
  );
  return res.rows;
}

async function listDistrictsByCanton(cantonId) {
  const cid = Number(cantonId);
  if (!Number.isInteger(cid) || cid <= 0) {
    const err = new Error('canton_id inválido.');
    err.status = 400;
    throw err;
  }
  const res = await pool.query(
    `SELECT id, canton_id, name, official_code
     FROM districts
     WHERE canton_id = $1
     ORDER BY name ASC`,
    [cid]
  );
  return res.rows;
}

module.exports = {
  listProvinces,
  listCantonsByProvince,
  listDistrictsByCanton,
};
