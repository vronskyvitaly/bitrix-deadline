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
 * Сформировать дату дедлайна: сегодня + N дней в формате Битрикс24
 * @param {number} days
 * @returns {string} — строка формата "YYYY-MM-DD"
 */
function calcDeadline(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

/**
 * Получить сегодняшнюю дату в формате "YYYY-MM-DD"
 */
function today() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Сравнить две даты: вернуть true если dateA < dateB
 * @param {string} dateA — "YYYY-MM-DD"
 * @param {string} dateB — "YYYY-MM-DD"
 */
function isDateBefore(dateA, dateB) {
  return new Date(dateA) < new Date(dateB);
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
