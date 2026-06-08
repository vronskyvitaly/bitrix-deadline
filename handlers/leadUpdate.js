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

        if (assignedUserId) {
          const leadUrl = `${config.bitrix.url}/crm/lead/details/${leadId}/`;
          const deadlineFormatted = bitrix.formatDate(prevState.deadline);
          const msg = `⛔ Лид #${leadId}: изменение дедлайна запрещено.\n` +
                      `Дедлайн можно изменить только в последний день срока — [b]${deadlineFormatted}[/b].\n\n` +
                      `Если нужно продление раньше срока — обратитесь к руководителю.\n` +
                      `[url=${leadUrl}]Открыть лид #${leadId}[/url]`;
          await bitrix.sendNotification(assignedUserId, msg).catch(console.error);
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

      // ✅ Последний день + причина указана — разрешаем
      console.log(`✅ Дедлайн изменён в последний день с причиной: "${currentReason}"`);
      await store.saveLeadState(leadId, {
        ...prevState,
        stageId: currentStage,
        deadline: currentDeadline,
      });
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

    // ✅ Причина указана — разрешаем продление
    console.log(`✅ Дедлайн продлён с причиной: "${currentReason}"`);

    await store.saveLeadState(leadId, {
      ...prevState,
      stageId: currentStage,
      deadline: currentDeadline,
    });

    // Уведомляем руководителя (первый менеджерский пользователь или отдельный ID)
    // Можно добавить ID руководителя в .env и подключить здесь
    if (assignedUserId) {
      const msg = `ℹ️ Менеджер продлил дедлайн по лиду #${leadId}.\n` +
                  `Новый дедлайн: ${currentDeadline}\n` +
                  `Причина: ${currentReason}`;
      // TODO: Отправить руководителю — добавьте MANAGER_USER_ID в .env
      console.log(`📨 Уведомление руководителю:`, msg);
    }

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
