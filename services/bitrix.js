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
 * Битрикс24 поле "Дата/Время" принимает формат "YYYY-MM-DD HH:MM:SS"
 * @param {number} days
 * @returns {string}
 */
function calcDeadline(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(23, 59, 0, 0); // конец рабочего дня
  const yyyy = date.getFullYear();
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const dd   = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} 23:59:00`;
}

/**
 * Получить сегодняшнюю дату в формате "YYYY-MM-DD HH:MM:SS" для Битрикс24
 */
function today() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  const hh   = String(d.getHours()).padStart(2, '0');
  const min  = String(d.getMinutes()).padStart(2, '0');
  const ss   = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

/**
 * Сравнить две даты: вернуть true если dateA < dateB
 * Работает со строками "YYYY-MM-DD" и "YYYY-MM-DD HH:MM:SS"
 */
function isDateBefore(dateA, dateB) {
  // Берём только дату без времени для сравнения
  const a = new Date(dateA.split(' ')[0]);
  const b = new Date(dateB.split(' ')[0]);
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
