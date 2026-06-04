const express = require('express');
const config = require('./config');
const { handleLeadUpdate } = require('./handlers/leadUpdate');
const store = require('./db/store');
const { scheduleDeadlineReminders } = require('./jobs/deadlineReminder');

const app = express();

// Защита от дублей: Bitrix24 при создании лида шлёт LEADADD + LEADUPDATE одновременно.
// Храним ID лидов, обработка которых уже запущена (10 секунд TTL).
const processingLeads = new Map();
function deduplicate(leadId) {
  if (processingLeads.has(leadId)) return false;
  processingLeads.set(leadId, true);
  setTimeout(() => processingLeads.delete(leadId), 10000);
  return true;
}

// Парсим тело запроса — Битрикс шлёт application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ─────────────────────────────────────────────
// Главный вебхук — принимает события из Битрикс24
// URL для настройки в Битрикс: https://your-server.com/webhook
// ─────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  // Битрикс24 ждёт быстрого ответа 200, иначе будет повторять запрос
  res.sendStatus(200);

  const body = req.body;
  const event = body.event;

  console.log(`\n📩 Вебхук получен: ${event || 'неизвестное событие'}`);

  // Обновление лида — основной сценарий
  if (event === 'ONCRMLEADUPDATE') {
    const leadId = body?.data?.FIELDS?.ID;
    if (!leadId) { console.warn('⚠️  В теле вебхука нет ID лида'); return; }
    if (!deduplicate(leadId)) {
      console.log(`⏭️  Лид #${leadId} уже обрабатывается, пропускаем дубль`);
      return;
    }
    handleLeadUpdate(leadId).catch(err => {
      console.error(`Ошибка обработки лида #${leadId}:`, err.message);
    });
  }

  // Создание лида — обрабатываем ТОЛЬКО если создан сразу в колонке менеджера
  if (event === 'ONCRMLEADADD') {
    const leadId  = body?.data?.FIELDS?.ID;
    const stageId = body?.data?.FIELDS?.STATUS_ID;
    if (!leadId) return;

    if (!config.managerStages.includes(stageId)) {
      console.log(`⏭️  Лид #${leadId} создан в стадии "${stageId}" (не менеджерская) — дедлайн не ставим`);
      return;
    }

    if (!deduplicate(leadId)) {
      console.log(`⏭️  Лид #${leadId} уже обрабатывается, пропускаем дубль`);
      return;
    }
    handleLeadUpdate(leadId).catch(err => {
      console.error(`Ошибка обработки нового лида #${leadId}:`, err.message);
    });
  }
});

// ─────────────────────────────────────────────
// Ручной запуск проверки дедлайнов (для тестирования)
// ─────────────────────────────────────────────
app.post('/admin/run-reminders', async (req, res) => {
  const { sendDeadlineReminders } = require('./jobs/deadlineReminder');
  res.json({ ok: true, message: 'Запущено' });
  sendDeadlineReminders().catch(console.error);
});

// ─────────────────────────────────────────────
// Просмотр данных в БД (последние 50 лидов)
// ─────────────────────────────────────────────
app.get('/admin/leads', async (req, res) => {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });
    const result = await pool.query(
      'SELECT lead_id, stage_id, deadline, taken_date, updated_at FROM lead_states ORDER BY updated_at DESC LIMIT 50'
    );
    await pool.end();
    res.json({ count: result.rows.length, leads: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// Health check — удобно для мониторинга сервера
// ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    bitrixUrl: config.bitrix.url,
    managerStages: config.managerStages,
    deadlineDays: config.deadlineDays,
  });
});

// ─────────────────────────────────────────────
// Запуск сервера
// ─────────────────────────────────────────────
store.init().catch(err => {
  console.error('❌ Ошибка подключения к PostgreSQL:', err.message);
  process.exit(1);
});

scheduleDeadlineReminders();

app.listen(config.server.port, () => {
  console.log('');
  console.log('🚀 Bitrix24 Deadline Webhook сервер запущен');
  console.log(`   Порт:            ${config.server.port}`);
  console.log(`   Битрикс URL:     ${config.bitrix.url}`);
  console.log(`   Стадии менеджеров: ${config.managerStages.join(', ')}`);
  console.log(`   Дедлайн (дней): ${config.deadlineDays}`);
  console.log('');
  console.log(`   Вебхук URL: http://your-server.com:${config.server.port}/webhook`);
  console.log(`   Health:     http://your-server.com:${config.server.port}/health`);
  console.log('');
});
