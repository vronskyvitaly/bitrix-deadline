const express = require('express');
const config = require('./config');
const { handleLeadUpdate } = require('./handlers/leadUpdate');
const store = require('./db/store');

const app = express();

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

  // Обрабатываем только обновление лида
  if (event === 'ONCRMLEADUPDATE') {
    const leadId = body?.data?.FIELDS?.ID;
    if (!leadId) {
      console.warn('⚠️  В теле вебхука нет ID лида');
      return;
    }
    // Асинхронная обработка после ответа 200
    handleLeadUpdate(leadId).catch(err => {
      console.error(`Ошибка обработки лида #${leadId}:`, err.message);
    });
  }

  // Новый лид — сохранить начальное состояние в хранилище
  if (event === 'ONCRMLREADADD') {
    const leadId = body?.data?.FIELDS?.ID;
    if (leadId) {
      const { getLeadState, saveLeadState } = require('./db/store');
      const bitrix = require('./services/bitrix');
      bitrix.getLead(leadId).then(lead => {
        saveLeadState(leadId, {
          stageId: lead.STATUS_ID,
          deadline: lead[config.fields.deadline] || null,
          takenDate: lead[config.fields.takenDate] || null,
        });
      }).catch(console.error);
    }
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
