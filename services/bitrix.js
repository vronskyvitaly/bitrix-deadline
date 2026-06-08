const axios = require('axios');
const config = require('../config');

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

/**
 * Универсальный вызов Bitrix24 REST API с повторными попытками при сетевых ошибках
 */
async function callApi(method, params = {}) {
  const url = `${config.bitrix.apiUrl}/${method}`;
  let lastErr;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await axios.post(url, params, { timeout: 10000 });
      if (response.data.error) {
        throw new Error(`Bitrix API Error [${method}]: ${response.data.error_description}`);
      }
      return response.data.result;
    } catch (err) {
      lastErr = err;
      const isNetworkError = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND'].includes(err.code);
      if (isNetworkError && attempt < RETRY_ATTEMPTS) {
        console.error(`⚠️ ${method} попытка ${attempt}/${RETRY_ATTEMPTS} не удалась (${err.code}), повтор через ${RETRY_DELAY_MS}ms...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      console.error(`❌ Ошибка вызова ${method}:`, err.message);
      throw err;
    }
  }
  throw lastErr;
}

//
/**
 * Получить лид по ID со всеми кастомными полями
 */
async function getLead(leadId) {
  return await callApi('crm.lead.get', { id: leadId });
}

/**
 * Обновить поля лида
 * @param {string|number} leadId
 * @param {object} fields — объект с полями для обновления
 */
async function updateLead(leadId, fields) {
  return await callApi('crm.lead.update', {
    id: leadId,
    fields: fields
  });
}

/**
 * Отправить уведомление пользователю в Битрикс24
 * @param {string|number} userId — ID пользователя в Битрикс24
 * @param {string} message — текст уведомления
 */
async function sendNotification(userId, message) {
  return await callApi('im.notify.system.add', {
    USER_ID: userId,
    MESSAGE: message,
  });
}

/**
 * Получить пользователя по ID
 */
async function getUser(userId) {
  const result = await callApi('user.get', { ID: userId });
  return Array.isArray(result) ? result[0] : result;
}

/**
 * Получить список пользователей
 */
async function getUsers() {
  return await callApi('user.get', { ACTIVE: true });
}

/**
 * Добавить комментарий в ленту событий лида
 */
async function addLeadComment(leadId, comment) {
  return await callApi('crm.timeline.comment.add', {
    fields: {
      ENTITY_ID: leadId,
      ENTITY_TYPE: 'lead',
      COMMENT: comment,
    }
  });
}

/**
 * Считает рабочие дни (пн-пт) от fromStr до toStr не включая fromStr
 */
function countWorkingDays(fromStr, toStr) {
  const from = new Date(fromStr.split('T')[0].split(' ')[0]);
  from.setHours(0, 0, 0, 0);
  const to = new Date(toStr.split('T')[0].split(' ')[0]);
  to.setHours(0, 0, 0, 0);
  let count = 0;
  const cur = new Date(from);
  cur.setDate(cur.getDate() + 1);
  while (cur <= to) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/**
 * Сформировать дату дедлайна: сегодня + N дней
 * Считает N рабочих дней вперёд (пн-пт), дедлайн в 18:00
 * @param {number} days — количество рабочих дней
 * @returns {string} ISO 8601 "YYYY-MM-DDTHH:MM:SS"
 */
function calcDeadline(days) {
  const date = new Date();
  let workingDaysAdded = 0;

  while (workingDaysAdded < days) {
    date.setDate(date.getDate() + 1);
    const dow = date.getDay(); // 0=вс, 6=сб
    if (dow !== 0 && dow !== 6) {
      workingDaysAdded++;
    }
  }

  const yyyy = date.getFullYear();
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const dd   = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T18:00:00`;
}

/**
 * Получить сегодняшнюю дату в формате ISO 8601 "YYYY-MM-DDTHH:MM:SS" для Битрикс24
 */
function today() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  const hh   = String(d.getHours()).padStart(2, '0');
  const min  = String(d.getMinutes()).padStart(2, '0');
  const ss   = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`;
}

/**
 * Сравнить две даты: вернуть true если dateA < dateB
 * Работает со строками "YYYY-MM-DD" и "YYYY-MM-DD HH:MM:SS"
 */
function isDateBefore(dateA, dateB) {
  const a = new Date(dateA.split('T')[0].split(' ')[0]);
  const b = new Date(dateB.split('T')[0].split(' ')[0]);
  return a < b;
}

/**
 * Проверить, является ли сегодня последним днём дедлайна
 * (то есть дата дедлайна совпадает с сегодняшней датой)
 */
function isDeadlineDay(deadlineStr, todayStr) {
  const d = deadlineStr.split('T')[0].split(' ')[0];
  const t = todayStr.split('T')[0].split(' ')[0];
  return d === t;
}

const MONTHS_RU = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];

/**
 * Форматировать дату в читаемый вид: "27 мая 2026 в 18:00"
 */
function formatDate(dateStr) {
  if (!dateStr) return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const day   = d.getDate();
  const month = MONTHS_RU[d.getMonth()];
  const year  = d.getFullYear();
  const hh    = String(d.getHours()).padStart(2, '0');
  const mm    = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year} в ${hh}:${mm}`;
}

module.exports = {
  callApi,
  getLead,
  updateLead,
  sendNotification,
  getUser,
  getUsers,
  addLeadComment,
  calcDeadline,
  countWorkingDays,
  today,
  isDateBefore,
  isDeadlineDay,
  formatDate,
};
