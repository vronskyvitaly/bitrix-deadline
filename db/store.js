/**
 * Хранилище состояний лидов на PostgreSQL.
 * При первом запуске автоматически создаёт таблицу lead_states.
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// Создаём таблицу при старте если не существует
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lead_states (
      lead_id     VARCHAR(50) PRIMARY KEY,
      stage_id    VARCHAR(100),
      deadline    VARCHAR(30),
      taken_date  VARCHAR(30),
      updated_at  TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log('✅ PostgreSQL: таблица lead_states готова');
}

/**
 * Получить состояние лида из БД
 * @param {string|number} leadId
 * @returns {{ stageId, deadline, takenDate } | null}
 */
async function getLeadState(leadId) {
  const res = await pool.query(
    'SELECT * FROM lead_states WHERE lead_id = $1',
    [String(leadId)]
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    stageId:   row.stage_id,
    deadline:  row.deadline,
    takenDate: row.taken_date,
  };
}

/**
 * Сохранить текущее состояние лида
 * @param {string|number} leadId
 * @param {{ stageId, deadline, takenDate }} state
 */
async function saveLeadState(leadId, state) {
  await pool.query(`
    INSERT INTO lead_states (lead_id, stage_id, deadline, taken_date, updated_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (lead_id) DO UPDATE SET
      stage_id   = EXCLUDED.stage_id,
      deadline   = EXCLUDED.deadline,
      taken_date = EXCLUDED.taken_date,
      updated_at = NOW()
  `, [String(leadId), state.stageId, state.deadline || null, state.takenDate || null]);
}

/**
 * Удалить состояние лида
 */
async function deleteLeadState(leadId) {
  await pool.query('DELETE FROM lead_states WHERE lead_id = $1', [String(leadId)]);
}

module.exports = {
  init,
  getLeadState,
  saveLeadState,
  deleteLeadState,
};
