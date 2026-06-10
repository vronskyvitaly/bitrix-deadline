/**
 * Обработчик события onCrmLeadUpdate от Битрикс24
 *
 * Логика:
 * 1. Менеджер переместил лид в свою колонку
 *    → Проставить UF_CRM_LEAD_TAKEN_DATE = сегодня
 *    → Проставить UF_CRM_LEAD_DEADLINE = сегодня + 5 дней
 *    → Отправить уведомление менеджеру
 *
 * 2. Менеджер изменил поле дедлайна вручную
 *    → Если старый дедлайн ещё НЕ прошёл — разрешить (менеджер скорректировал заранее)
 *    → Если старый дедлайн уже ПРОШЁЛ:
 *       а) Поле "причина продления" заполнено → разрешить, уведомить руководителя
 *       б) Поле "причина продления" пустое  → ОТКАТИТЬ дедлайн, потребовать объяснение
 */

const config = require('../config');
const bitrix = require('../services/bitrix');
const store = require('../db/store');

/**
 * Применить продление дедлайна: проверить лимит, записать комментарий,
 * очистить поле причины, уведомить руководителя.
 */
async function applyDeadlineExtension({ leadId, assignedUserId, prevState, currentStage, currentDeadline, currentReason }) {
  const leadUrl = `${config.bitrix.url}/crm/lead/details/${leadId}/`;

  // Проверяем лимит: нельзя продлить более чем на config.deadlineDays рабочих дней от сегодня
  const maxDeadline = bitrix.calcDeadline(config.deadlineDays);
  const maxDateStr  = maxDeadline.split('T')[0];
  const newDateStr  = (currentDeadline || '').split('T')[0].split(' ')[0];

  if (newDateStr > maxDateStr) {
    console.log(`❌ Новый дедлайн ${newDateStr} превышает лимит ${maxDateStr}. Откатываем.`);
    try {
      await bitrix.updateLead(leadId, { [config.fields.deadline]: prevState.deadline });
    } catch (err) {
      console.error('Ошибка при откате дедлайна:', err.message);
    }
    if (assignedUserId) {
      const maxFormatted = bitrix.formatDate(maxDeadline);
      const msg = `⛔ Лид #${leadId}: нельзя продлить дедлайн более чем на ${config.deadlineDays} рабочих дней.\n` +
                  `Максимальная дата: [b]${maxFormatted}[/b].\n` +
                  `[url=${leadUrl}]Открыть лид #${leadId}[/url]`;
      await bitrix.sendNotification(assignedUserId, msg).catch(console.error);
    }
    return;
  }

  // Получаем имя менеджера для комментария
  let managerName = assignedUserId ? `ID ${assignedUserId}` : 'Менеджер';
  try {
    const user = await bitrix.getUser(assignedUserId);
    console.log(`👤 getUser(${assignedUserId}):`, JSON.stringify(user));
    if (user) managerName = [user.NAME, user.LAST_NAME].filter(Boolean).join(' ') || managerName;
  } catch (e) { console.error(`❌ getUser(${assignedUserId}) failed:`, e.message); }

  const prevFormatted = bitrix.formatDate(prevState.deadline);
  const newFormatted  = bitrix.formatDate(currentDeadline);
  const daysAdded     = bitrix.countWorkingDays(bitrix.today(), currentDeadline);
  const nowFormatted  = bitrix.formatDate(bitrix.today());

  // Записываем комментарий в историю лида
  const comment = `📅 Дедлайн продлён\n` +
                  `Кто: ${managerName}\n` +
                  `Когда: ${nowFormatted}\n` +
                  `Было: ${prevFormatted}\n` +
                  `Стало: ${newFormatted}\n` +
                  `Продлено на: ${daysAdded} раб. дн.\n` +
                  `Причина: ${currentReason}`;
  await bitrix.addLeadComment(leadId, comment).catch(err => console.error('Ошибка добавления комментария:', err.message));

  // Очищаем поле причины продления
  await bitrix.updateLead(leadId, { [config.fields.extendReason]: '' }).catch(console.error);

  // Сохраняем новое состояние
  await store.saveLeadState(leadId, { ...prevState, stageId: currentStage, deadline: currentDeadline });
  console.log(`✅ Дедлайн продлён на ${daysAdded} раб. дн., комментарий записан, причина очищена.`);

  // Уведомляем руководителя
  if (config.supervisorUserId) {
    const supervisorMsg = `ℹ️ ${managerName} продлил дедлайн по лиду #${leadId}.\n` +
                          `Было: ${prevFormatted} → Стало: ${newFormatted}\n` +
                          `Продлено на: ${daysAdded} раб. дн.\n` +
                          `Причина: ${currentReason}\n` +
                          `[url=${leadUrl}]Открыть лид #${leadId}[/url]`;
    await bitrix.sendNotification(config.supervisorUserId, supervisorMsg).catch(console.error);
  }
}

async function handleLeadUpdate(leadId) {
  console.log(`\n📥 Обработка обновления лида #${leadId}`);

  // Получаем актуальное состояние лида из Битрикс24
  let lead;
  try {
    lead = await bitrix.getLead(leadId);
  } catch (err) {
    console.error(`Не удалось получить лид #${leadId}:`, err.message);
    return;
  }

  const currentStage    = lead.STATUS_ID;
  const currentDeadline = lead[config.fields.deadline] || null;
  const currentReason   = lead[config.fields.extendReason] || '';
  const assignedUserId  = lead.ASSIGNED_BY_ID;

  // Читаем предыдущее состояние из хранилища
  const prevState = await store.getLeadState(leadId);

  // ─────────────────────────────────────────────
  // КЕЙС 1: Лид попал в менеджерскую стадию
  // Срабатывает при любом переходе в менеджерскую стадию:
  // из необработанного, из другой менеджерской, или первое появление лида
  // ─────────────────────────────────────────────
  const isManagerStage = config.managerStages.includes(currentStage);
  const stageChanged = !prevState || prevState.stageId !== currentStage;

  if (isManagerStage && stageChanged) {
    console.log(`🔄 Лид #${leadId} перемещён в менеджерскую стадию "${currentStage}"`);

    const takenDate   = bitrix.today();
    const newDeadline = bitrix.calcDeadline(config.deadlineDays);

    try {
      await bitrix.updateLead(leadId, {
        [config.fields.takenDate]: takenDate,
        [config.fields.deadline]: newDeadline,
        [config.fields.extendReason]: '', // сбрасываем причину при переназначении
      });
      console.log(`✅ Дедлайн установлен: ${newDeadline} (взят в работу: ${takenDate})`);
    } catch (err) {
      console.error('Ошибка при установке дедлайна:', err.message);
    }

    // Уведомляем менеджера
    if (assignedUserId) {
      const leadUrl = `${config.bitrix.url}/crm/lead/details/${leadId}/`;
      const deadlineFormatted = bitrix.formatDate(newDeadline);
      const msg = `📋 Лид #${leadId} (${lead.TITLE || 'без названия'}) взят в работу.\n` +
                  `⏰ Дедлайн: ${deadlineFormatted}.\n` +
                  `Не забудьте отправить договор и все необходимые документы.\n` +
                  `[url=${leadUrl}]Открыть лид[/url]`;
      await bitrix.sendNotification(assignedUserId, msg).catch(console.error);
    }

    // Сохраняем новое состояние
    await store.saveLeadState(leadId, {
      stageId: currentStage,
      deadline: newDeadline,
      takenDate: takenDate,
    });

    return;
  }

  // ─────────────────────────────────────────────
  // КЕЙС 2: Менеджер изменил дедлайн вручную
  // ─────────────────────────────────────────────
  if (prevState && prevState.deadline && currentDeadline !== prevState.deadline) {
    console.log(`🔄 Лид #${leadId}: дедлайн изменён ${prevState.deadline} → ${currentDeadline}`);

    const today = bitrix.today();
    const oldDeadlinePassed = bitrix.isDateBefore(prevState.deadline, today);

    if (!oldDeadlinePassed) {
      // Дедлайн ещё не прошёл — разрешаем только в последний день (день дедлайна)
      const isLastDay = bitrix.isDeadlineDay(prevState.deadline, today);

      if (!isLastDay) {
        // ❌ Слишком рано — откатываем
        console.log(`❌ Изменение дедлайна до последнего дня — запрещено. Откатываем.`);
        try {
          await bitrix.updateLead(leadId, {
            [config.fields.deadline]: prevState.deadline,
          });
        } catch (err) {
          console.error('Ошибка при откате дедлайна:', err.message);
        }

        const leadUrl = `${config.bitrix.url}/crm/lead/details/${leadId}/`;
        const deadlineFormatted = bitrix.formatDate(prevState.deadline);

        if (assignedUserId) {
          const msg = `⛔ Лид #${leadId}: изменение дедлайна запрещено.\n` +
                      `Дедлайн можно изменить только в последний день срока — [b]${deadlineFormatted}[/b].\n\n` +
                      `Чтобы перенести дедлайн:\n` +
                      `1. [url=${leadUrl}]Откройте лид #${leadId}[/url]\n` +
                      `2. В последний день срока заполните поле [b]«Причина продления»[/b]\n` +
                      `3. После этого измените дату дедлайна`;
          await bitrix.sendNotification(assignedUserId, msg).catch(console.error);
        }

        // Уведомляем руководителя о попытке раннего переноса
        if (config.supervisorUserId) {
          let managerName = assignedUserId ? `ID ${assignedUserId}` : 'Менеджер';
          try {
            const user = await bitrix.getUser(assignedUserId);
            if (user) managerName = [user.NAME, user.LAST_NAME].filter(Boolean).join(' ') || managerName;
          } catch (e) { console.error(`❌ getUser(${assignedUserId}) failed:`, e.message); }
          const supervisorMsg = `⚠️ ${managerName} попытался перенести дедлайн по лиду #${leadId} раньше срока.\n` +
                                `Текущий дедлайн: [b]${deadlineFormatted}[/b]\n` +
                                `Изменение отклонено.\n` +
                                `[url=${leadUrl}]Открыть лид #${leadId}[/url]`;
          await bitrix.sendNotification(config.supervisorUserId, supervisorMsg).catch(console.error);
        }
        return;
      }

      // Последний день — требуем причину продления
      if (!currentReason || currentReason.trim() === '') {
        // ❌ Причина не указана — откатываем
        console.log(`❌ Последний день дедлайна, причина не указана. Откатываем.`);
        try {
          await bitrix.updateLead(leadId, {
            [config.fields.deadline]: prevState.deadline,
          });
        } catch (err) {
          console.error('Ошибка при откате дедлайна:', err.message);
        }

        if (assignedUserId) {
          const leadUrl = `${config.bitrix.url}/crm/lead/details/${leadId}/`;
          const deadlineFormatted = bitrix.formatDate(prevState.deadline);
          const msg = `⛔ Лид #${leadId}: изменение дедлайна отклонено.\n` +
                      `Сегодня последний день срока — [b]${deadlineFormatted}[/b].\n\n` +
                      `Чтобы продлить дедлайн:\n` +
                      `1. [url=${leadUrl}]Откройте лид #${leadId}[/url]\n` +
                      `2. Заполните поле [b]«Причина продления»[/b]\n` +
                      `3. После этого измените дату дедлайна`;
          await bitrix.sendNotification(assignedUserId, msg).catch(console.error);
        }
        return;
      }

      // ✅ Последний день + причина — проверяем лимит 5 рабочих дней
      console.log(`✅ Последний день, причина указана. Проверяем лимит.`);
      await applyDeadlineExtension({ leadId, assignedUserId, prevState, currentStage, currentDeadline, currentReason });
      return;
    }

    // Старый дедлайн прошёл — проверяем причину
    if (!currentReason || currentReason.trim() === '') {
      // ❌ Причина не указана — ОТКАТЫВАЕМ дедлайн
      console.log(`❌ Дедлайн прошёл, причина продления не указана. Откатываем дедлайн.`);

      try {
        await bitrix.updateLead(leadId, {
          [config.fields.deadline]: prevState.deadline,
        });
      } catch (err) {
        console.error('Ошибка при откате дедлайна:', err.message);
      }

      // Уведомляем менеджера
      if (assignedUserId) {
        const leadUrl = `${config.bitrix.url}/crm/lead/details/${leadId}/`;
        const deadlineFormatted = bitrix.formatDate(prevState.deadline);
        const msg = `⚠️ Лид #${leadId}: изменение дедлайна отклонено.\n` +
                    `Прежний срок [b]${deadlineFormatted}[/b] уже истёк.\n\n` +
                    `Чтобы продлить дедлайн:\n` +
                    `1. [url=${leadUrl}]Откройте лид #${leadId}[/url]\n` +
                    `2. Заполните поле [b]«Причина продления»[/b]\n` +
                    `3. После этого измените дату дедлайна`;
        await bitrix.sendNotification(assignedUserId, msg).catch(console.error);
      }

      // Состояние НЕ обновляем — откатились к старому дедлайну
      return;
    }

    // ✅ Причина указана — проверяем лимит 5 рабочих дней
    console.log(`✅ Дедлайн истёк, причина указана. Проверяем лимит.`);
    await applyDeadlineExtension({ leadId, assignedUserId, prevState, currentStage, currentDeadline, currentReason });
    return;
  }

  // ─────────────────────────────────────────────
  // По умолчанию: просто обновляем стадию в хранилище
  // ─────────────────────────────────────────────
  if (prevState) {
    await store.saveLeadState(leadId, {
      ...prevState,
      stageId: currentStage,
    });
  } else {
    // Первое появление лида — сохраняем базовое состояние
    await store.saveLeadState(leadId, {
      stageId: currentStage,
      deadline: currentDeadline,
      takenDate: lead[config.fields.takenDate] || null,
    });
  }
}

module.exports = { handleLeadUpdate };
