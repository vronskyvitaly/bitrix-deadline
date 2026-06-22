require('dotenv').config();

const config = {
  bitrix: {
    url: process.env.BITRIX_URL,
    webhookToken: process.env.BITRIX_WEBHOOK_TOKEN,
    // Базовый URL для API вызовов
    get apiUrl() {
      return `${this.url}/rest/${this.webhookToken}`;
    }
  },

  // Стадии лида, при перемещении в которые назначается дедлайн
  // Формат: массив строк с ID стадий
  managerStages: (process.env.MANAGER_STAGES || '').split(',').map(s => s.trim()).filter(Boolean),

  // Стадии-исключения: дедлайны не ставятся, уведомления не шлются
  ignoredStages: (process.env.IGNORED_STAGES || 'UC_D5OI8U,JUNK').split(',').map(s => s.trim()).filter(Boolean),

  // Названия кастомных полей лида
  fields: {
    deadline: process.env.FIELD_DEADLINE || 'UF_CRM_LEAD_DEADLINE',
    takenDate: process.env.FIELD_TAKEN_DATE || 'UF_CRM_LEAD_TAKEN_DATE',
    extendReason: process.env.FIELD_EXTEND_REASON || 'UF_CRM_LEAD_EXTEND_REASON',
  },

  // Количество дней дедлайна
  deadlineDays: parseInt(process.env.DEADLINE_DAYS || '5', 10),

  // ID руководителя в Битрикс24 для уведомлений о переносе дедлайнов
  supervisorUserId: process.env.SUPERVISOR_USER_ID ? parseInt(process.env.SUPERVISOR_USER_ID, 10) : null,

  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    webhookSecret: process.env.WEBHOOK_SECRET || '',
  }
};

// Проверка обязательных переменных при старте
function validateConfig() {
  const required = ['BITRIX_URL', 'BITRIX_WEBHOOK_TOKEN', 'MANAGER_STAGES'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error('❌ Отсутствуют обязательные переменные окружения:', missing.join(', '));
    console.error('   Скопируйте .env в .env и заполните значения');
    process.exit(1);
  }
}

validateConfig();

module.exports = config;
