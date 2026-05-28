# Bitrix-Deadline

Webhook-сервер на Node.js, который автоматически управляет дедлайнами лидов в CRM Bitrix24. Когда менеджер берёт лид в работу — система сама ставит дедлайн и следит за его соблюдением.

**Продакшн:** https://bitrixdeadline.tamozhennybrokeragents.ru

---

## Как это работает

### 1. Лид взят в работу
Менеджер перемещает лид в свою колонку CRM → система автоматически:
- Записывает дату взятия в работу
- Ставит дедлайн: **+5 рабочих дней** (пн–пт), в **18:00**
- Отправляет менеджеру уведомление в Bitrix24 со ссылкой на лид

### 2. Менеджер пытается изменить дедлайн вручную
| Ситуация | Что происходит |
|---|---|
| Дедлайн ещё не истёк | Изменение принимается без вопросов |
| Дедлайн истёк, причина **не** указана | Дедлайн откатывается, менеджер получает уведомление с инструкцией |
| Дедлайн истёк, причина **указана** | Изменение принимается, руководитель уведомлён |

---

## Стек

| | |
|---|---|
| Runtime | Node.js 20 |
| Framework | Express |
| БД | PostgreSQL (таблица `lead_states`) |
| Инфраструктура | Docker → Coolify → Traefik (SSL) |
| Интеграция | Bitrix24 REST API, webhook `ONCRMLEADUPDATE` |

---

## Структура проекта

```
bitrix-deadline/
├── server.js           # Express-сервер, точка входа
├── config.js           # Конфигурация из переменных окружения
├── Dockerfile
├── handlers/
│   └── leadUpdate.js   # Вся бизнес-логика обработки лида
├── services/
│   └── bitrix.js       # Обёртка над Bitrix24 REST API (с retry)
└── db/
    └── store.js        # Чтение/запись состояний лидов в PostgreSQL
```

---

## Переменные окружения

Создать файл `.env` (шаблон: `.env.example`):

```env
# Bitrix24
BITRIX_URL=https://yourcompany.bitrix24.ru
BITRIX_WEBHOOK_TOKEN=1/abc123xyz        # токен входящего вебхука

# Стадии лидов, при перемещении в которые назначается дедлайн
MANAGER_STAGES=IN_PROCESS,UC_5EXAZE,UC_01K07L

# Коды кастомных полей лида (узнать в CRM → Лиды → Пользовательские поля)
FIELD_DEADLINE=UF_CRM_1234567890
FIELD_TAKEN_DATE=UF_CRM_1234567891
FIELD_EXTEND_REASON=UF_CRM_1234567892

# Настройки сервера
DEADLINE_DAYS=5
PORT=3000

# PostgreSQL
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
```

---

## Локальный запуск

```bash
npm install
cp .env.example .env   # заполнить значения
npm run dev            # с hot-reload через nodemon
```

Проверить: `curl http://localhost:3000/health`

---

## Деплой

Проект разворачивается через **Coolify** из ветки `main`. При каждом `git push` в `main` Coolify автоматически пересобирает Docker-образ и перезапускает контейнер.

Ручной деплой через Coolify API:
```bash
curl -X GET "http://COOLIFY_HOST:8000/api/v1/deploy?uuid=APP_UUID" \
  -H "Authorization: Bearer COOLIFY_TOKEN"
```

---

## Настройка Bitrix24

Подробная инструкция по созданию полей, вебхуков и стадий — в [SETUP.md](SETUP.md).
