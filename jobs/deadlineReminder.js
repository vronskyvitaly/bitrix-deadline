/**
 * Ежедневное уведомление о дедлайне
 *
 * Запускается каждое утро в 9:00 по московскому времени.
 * Находит все лиды в менеджерских стадиях у которых дедлайн СЕГОДНЯ
 * и отправляет уведомление ответственному менеджеру.
 */

const cron = require('node-cron');
const { Pool } = require('pg');
const bitrix = require('../services/bitrix');
const config = require('../config');

async function sendDeadlineReminders() {
  console.log('\n⏰ Запуск ежедневной проверки дедлайнов...');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  try {
    // Текущая дата в формате YYYY-MM-DD
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm   = String(today.getMonth() + 1).padStart(2, '0');
    const dd   = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;

    // Ищем лиды у которых дедлайн сегодня и стадия менеджерская
    const result = await pool.query(`
      SELECT lead_id, stage_id, deadline
      FROM lead_states
      WHERE deadline LIKE $1
        AND stage_id = ANY($2)
    `, [`${todayStr}%`, config.managerStages]);

    console.log(`📋 Найдено лидов с дедлайном сегодня (${todayStr}): ${result.rows.length}`);

    for (const row of result.rows) {
      try {
        const lead = await bitrix.getLead(row.lead_id);
        const assignedUserId = lead.ASSIGNED_BY_ID;
        if (!assignedUserId) continue;

        const leadUrl = `${config.bitrix.url}/crm/lead/details/${row.lead_id}/`;
        const deadlineFormatted = bitrix.formatDate(row.deadline);

        const msg = `🔔 Лид #${row.lead_id} (${lead.TITLE || 'без названия'}) — сегодня последний день дедлайна!\n\n` +
                    `⏰ Срок истекает: [b]${deadlineFormatted}[/b]\n\n` +
                    `Если нужно продление — сегодня последний день когда можно изменить дедлайн. ` +
                    `Не забудьте указать причину продления.\n\n` +
                    `[url=${leadUrl}]Открыть лид #${row.lead_id}[/url]`;

        await bitrix.sendNotification(assignedUserId, msg);
        console.log(`✅ Уведомление отправлено менеджеру ${assignedUserId} по лиду #${row.lead_id}`);
      } catch (err) {
        console.error(`❌ Ошибка отправки уведомления по лиду #${row.lead_id}:`, err.message);
      }
    }
  } finally {
    await pool.end();
  }

  console.log('✅ Проверка дедлайнов завершена\n');
}

function scheduleDeadlineReminders() {
  // Каждый день в 9:00 по Москве (UTC+3 = 06:00 UTC)
  cron.schedule('0 6 * * *', sendDeadlineReminders, { timezone: 'UTC' });
  console.log('⏰ Ежедневная проверка дедлайнов запланирована на 09:00 МСК');
}

module.exports = { scheduleDeadlineReminders, sendDeadlineReminders };
