/**
 * Ежедневные уведомления о дедлайнах
 *
 * 09:00 МСК — напоминание если дедлайн сегодня
 * 10:00 МСК (пн–пт) — напоминание если дедлайн уже просрочен
 *
 * Перед отправкой проверяем актуальную стадию лида в Bitrix24.
 * Если лид в спаме, сделке или другой игнорируемой стадии — уведомление не шлётся,
 * запись из БД очищается.
 */

const cron = require('node-cron');
const { Pool } = require('pg');
const bitrix = require('../services/bitrix');
const store = require('../db/store');
const config = require('../config');

function getPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
}

async function sendDeadlineReminders() {
  console.log('\n⏰ Запуск ежедневной проверки дедлайнов...');

  const pool = getPool();

  try {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm   = String(today.getMonth() + 1).padStart(2, '0');
    const dd   = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;

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

        // Проверяем актуальную стадию — лид мог переехать в спам или стать сделкой
        if (config.ignoredStages.includes(lead.STATUS_ID)) {
          console.log(`⏭️  Лид #${row.lead_id} сейчас в стадии "${lead.STATUS_ID}" (игнорируется) — очищаем БД, пропускаем`);
          await store.deleteLeadState(row.lead_id).catch(() => {});
          continue;
        }

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

async function sendOverdueReminders() {
  console.log('\n⏰ Запуск проверки просроченных дедлайнов...');

  const pool = getPool();

  try {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm   = String(today.getMonth() + 1).padStart(2, '0');
    const dd   = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;

    const result = await pool.query(`
      SELECT lead_id, stage_id, deadline
      FROM lead_states
      WHERE deadline < $1
        AND stage_id = ANY($2)
    `, [todayStr, config.managerStages]);

    console.log(`📋 Найдено просроченных лидов (до ${todayStr}): ${result.rows.length}`);

    for (const row of result.rows) {
      try {
        const lead = await bitrix.getLead(row.lead_id);

        // Проверяем актуальную стадию — лид мог переехать в спам или стать сделкой
        if (config.ignoredStages.includes(lead.STATUS_ID)) {
          console.log(`⏭️  Лид #${row.lead_id} сейчас в стадии "${lead.STATUS_ID}" (игнорируется) — очищаем БД, пропускаем`);
          await store.deleteLeadState(row.lead_id).catch(() => {});
          continue;
        }

        const assignedUserId = lead.ASSIGNED_BY_ID;
        if (!assignedUserId) continue;

        const leadUrl = `${config.bitrix.url}/crm/lead/details/${row.lead_id}/`;
        const deadlineFormatted = bitrix.formatDate(row.deadline);

        const msg = `⚠️ Лид #${row.lead_id} (${lead.TITLE || 'без названия'}) — срок дедлайна истёк!\n\n` +
                    `⏰ Срок истёк: [b]${deadlineFormatted}[/b]\n\n` +
                    `Чтобы перенести дедлайн:\n` +
                    `1. [url=${leadUrl}]Откройте лид #${row.lead_id}[/url]\n` +
                    `2. Заполните поле [b]«Причина продления»[/b]\n` +
                    `3. После этого измените дату дедлайна`;

        await bitrix.sendNotification(assignedUserId, msg);
        console.log(`✅ Напоминание о просроченном дедлайне отправлено менеджеру ${assignedUserId} по лиду #${row.lead_id}`);
      } catch (err) {
        console.error(`❌ Ошибка отправки напоминания по лиду #${row.lead_id}:`, err.message);
      }
    }
  } finally {
    await pool.end();
  }

  console.log('✅ Проверка просроченных дедлайнов завершена\n');
}

function scheduleDeadlineReminders() {
  // Каждый день в 9:00 по Москве (UTC+3 = 06:00 UTC)
  cron.schedule('0 6 * * *', sendDeadlineReminders, { timezone: 'UTC' });
  console.log('⏰ Ежедневная проверка дедлайнов запланирована на 09:00 МСК');

  // Каждый рабочий день в 10:00 по Москве (07:00 UTC) — напоминание о просроченных
  cron.schedule('0 7 * * 1-5', sendOverdueReminders, { timezone: 'UTC' });
  console.log('⏰ Ежедневная проверка просроченных дедлайнов запланирована на 10:00 МСК (пн–пт)');
}

module.exports = { scheduleDeadlineReminders, sendDeadlineReminders, sendOverdueReminders };
