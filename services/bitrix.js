const axios = require('axios');
const config = require('../config');

/**
 * Универсальный вызов Bitrix24 REST API
 */
async function callApi(method, params = {}) {
  const url = `${config.bitrix.apiUrl}/${method}`;
  try {
    const response = await axios.post(url, params);
    if (response.data.error) {
      throw new Error(`Bitrix API Error [${method}]: ${response.data.error_description}`);
    }
    return response.data.result;
  } catch (err) {
    console.error(`❌ Ошибка вызова ${method}:`, err.message);
    throw err;
  }
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
 * Получить список пользователей (для поиска менеджера по стадии)
 */
async function getUsers() {
  return await callApi('user.get', { ACTIVE: true });
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
  // Берём только дату без времени для сравнения (поддержка как "T" так и " " разделителей)
  const a = new Date(dateA.split('T')[0].split(' ')[0]);
  const b = new Date(dateB.split('T')[0].split(' ')[0]);
  return a < b;
}

module.exports = {
  callApi,
  getLead,
  updateLead,
  sendNotification,
  getUsers,
  calcDeadline,
  today,
  isDateBefore,
};
