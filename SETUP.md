# Инструкция по настройке Bitrix24 Deadline Webhook

## Шаг 1 — Создать кастомные поля в Битрикс24

Перейти: **CRM → Лиды → Настройки (шестерёнка) → Пользовательские поля**

Создать три поля:

| Название поля       | Тип       | Код поля (запишите!)          |
|---------------------|-----------|-------------------------------|
| Дедлайн менеджера   | Дата      | `UF_CRM_LEAD_DEADLINE`        |
| Дата взятия в работу| Дата      | `UF_CRM_LEAD_TAKEN_DATE`      |
| Причина продления   | Строка    | `UF_CRM_LEAD_EXTEND_REASON`   |

> Коды полей Битрикс присваивает автоматически. Запишите их — они понадобятся в .env

---

## Шаг 2 — Узнать ID стадий менеджеров

Откройте в браузере (вставьте свой домен и токен):
```
https://ВАШ_ДОМЕН.bitrix24.ru/rest/ТОКЕН/crm.status.list?FILTER[ENTITY_ID]=STATUS
```

Найдите стадии, соответствующие колонкам 4 менеджеров. Запишите их `STATUS_ID` — например: `IN_PROCESS`, `MANAGER1`, и т.д.

---

## Шаг 3 — Создать входящий вебхук в Битрикс24

1. Перейти: **Разработчикам → Другое → Входящий вебхук** (или Настройки → Интеграции)
2. Нажать **Добавить вебхук**
3. Отметить права: `CRM` (чтение и запись), `IM` (уведомления)
4. Сохранить → скопировать URL токена

Токен будет выглядеть так: `https://company.bitrix24.ru/rest/1/abc123xyz/`  
Вам нужна часть после `/rest/1/` → это `abc123xyz` — ваш `BITRIX_WEBHOOK_TOKEN`

---

## Шаг 4 — Настроить исходящий вебхук (событие onCrmLeadUpdate)

1. Перейти: **Разработчикам → Другое → Исходящий вебхук**
2. Нажать **Добавить**
3. Тип события: `onCrmLeadUpdate` (Изменение лида)
4. URL обработчика: `https://ВАШ_СЕРВЕР/webhook`
5. Сохранить

---

## Шаг 5 — Развернуть сервер на VPS

### Установка Node.js
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Загрузить проект
```bash
# Скопировать файлы на сервер (через scp или git)
git clone <ваш-репозиторий> /opt/bitrix-deadline
cd /opt/bitrix-deadline
npm install
```

### Настроить .env
```bash
cp .env .env
nano .env
```

Заполнить значения:
```
BITRIX_URL=https://yourcompany.bitrix24.ru
BITRIX_WEBHOOK_TOKEN=abc123xyz
MANAGER_STAGES=IN_PROCESS,MANAGER1,MANAGER2,MANAGER3
FIELD_DEADLINE=UF_CRM_LEAD_DEADLINE_123   # ваш реальный код поля
FIELD_TAKEN_DATE=UF_CRM_LEAD_TAKEN_DATE_456
FIELD_EXTEND_REASON=UF_CRM_LEAD_EXTEND_REASON_789
DEADLINE_DAYS=5
PORT=3000
```

### Запустить как системный сервис (pm2)
```bash
npm install -g pm2
pm2 start server.js --name bitrix-deadline
pm2 save
pm2 startup   # автозапуск после перезагрузки сервера
```

### Проверить работу
```bash
curl http://localhost:3000/health
```

---

## Шаг 6 — Настроить Nginx (опционально, для HTTPS)

Битрикс24 в облаке требует HTTPS для вебхуков.

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Получить SSL сертификат:
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

После этого URL вебхука: `https://your-domain.com/webhook`

---

## Структура проекта

```
bitrix-deadline/
├── server.js              # Express сервер, точка входа
├── config.js              # Конфигурация из .env
├── .env.example           # Шаблон переменных окружения
├── .env                   # Ваши настройки (не коммитить в git!)
├── package.json
├── handlers/
│   └── leadUpdate.js      # Основная логика обработки лида
├── services/
│   └── bitrix.js          # Обёртка над Bitrix24 REST API
└── db/
    ├── store.js            # Хранилище состояний лидов
    └── leads.json          # Данные (создаётся автоматически)
```

---

## Как работает логика

```
Менеджер перемещает лид в свою колонку
    ↓
onCrmLeadUpdate вебхук → наш сервер
    ↓
Определяем: стадия изменилась на менеджерскую?
    ↓ ДА
Записываем дату взятия в работу + дедлайн (+5 дней)
Отправляем уведомление менеджеру
    
    ↓ Через 5 дней менеджер хочет продлить дедлайн
    
Менеджер меняет поле "Дедлайн"
    ↓
onCrmLeadUpdate → сервер сравнивает с сохранённым дедлайном
    ↓
Старый дедлайн уже прошёл?
    ├── НЕТ → разрешаем (скорректировал заранее)
    └── ДА →  поле "Причина продления" заполнено?
                ├── ДА → разрешаем, уведомляем руководителя
                └── НЕТ → ОТКАТЫВАЕМ дедлайн + уведомление менеджеру
```
