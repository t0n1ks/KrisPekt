# KrisPekt

Рукописные конспекты по предметам: полка с тетрадями, письмо стилусом, PDF и фото, всё — прямо в браузере.

**Открыть приложение:** https://t0n1ks.github.io/KrisPekt/

© 2026 t0n1ks

> **English summary.** KrisPekt is an offline-first web app (PWA) for handwritten notes organised by subject. Write with a stylus (pressure, palm rejection, line straightening), highlight, erase, select with a lasso, add text, photos and PDF pages, and export notebooks to PDF. Everything is stored locally in the browser (IndexedDB); there is no account and no server. Interface languages: Ukrainian, Russian, German and English. Built with TypeScript and Vite, deployed to GitHub Pages by GitHub Actions. The code is proprietary: see [License](#лицензия--license).

## Что умеет

- **Полка:** предметы → тетради с обложками, поиск, резервная копия и восстановление.
- **Редактор:** ручка с нажимом стилуса, маркер, ластик (часть штриха или штрих целиком), лассо (перемещение, размер, цвет, копия, удаление), текст, фото, линейка, отмена/повтор, касание двумя пальцами — отмена, задержка стилуса — ровная линия, масштаб щипком, листание с инерцией.
- **Замочек размера страницы:** размер тетради закреплён за первой страницей; новые страницы с замком получают его, без замка — размер предыдущей страницы.
- **PDF:** страницы PDF можно добавить как фон, тетрадь — сохранить в PDF.
- **Языки:** українська, русский, Deutsch, English.

## Как установить на телефон или планшет

1. Открой ссылку выше в Chrome (Android) или Safari (iPhone/iPad).
2. Chrome: меню **⋮ → «Добавить на главный экран»** (или «Установить приложение»). Safari: **«Поделиться» → «На экран „Домой“»**.
3. Приложение откроется в отдельном окне и будет работать без интернета.

## Где хранятся данные

- **Все тетради хранятся только в браузере на этом устройстве.** Никуда не отправляются: у приложения нет сервера, аналитики и внешних запросов.
- У каждого человека по ссылке своя полка (сначала с примером тетради). Синхронизации между устройствами нет.
- **Перенос и страховка:** на полке **⋯ → «Сохранить резервную копию»** скачивает файл `krispekt-ГГГГ-ММ-ДД.json`. На другом устройстве **⋯ → «Восстановить из копии»**. Тетради с такими же id заменятся версией из копии, остальные останутся.
- Копия проверяется целиком до записи: файл с ошибками или чужими данными не импортируется вовсе, а существующие тетради не трогаются.
- Очистка данных сайта или другой браузер покажут пустую полку — поэтому стоит иногда сохранять копию.

## Запуск локально

Нужен Node.js 22.13+ (LTS) и npm.

```bash
npm install        # зависимости
npm run dev        # сервер разработки: http://localhost:5173/KrisPekt/
npm test           # модульные тесты (Vitest)
npm run lint       # ESLint
npm run build      # сборка в dist/
npm run preview    # проверить сборку: http://localhost:4173/KrisPekt/
npm run test:e2e   # смоук-тест Playwright (после npm run build; первый раз: npx playwright install chromium)
```

Публикация: каждый push в `main` запускает GitHub Actions (`npm ci` → `npm audit` → lint → тесты → сборка → GitHub Pages).

## Архитектура

TypeScript (strict), Vite, без фреймворков: интерфейс — небольшие классы над DOM, ядро — свой рендер на canvas.

```
src/
├─ main.ts          точка входа: стили, App, регистрация service worker
├─ app/             App (корень композиции, все зависимости через конструкторы), EventBus
├─ core/            типы, константы, утилиты (DOM, id, файлы, даты)
├─ i18n/            I18n и словари uk/ru/de/en
├─ storage/         IndexedDB, репозитории, очередь сохранения, настройки, резервные копии, валидация
├─ domain/          чистая логика: замочек размера, пресеты, история отмен, пример тетради
├─ services/        LibraryService — операции с полкой
├─ editor/          состояние открытой тетради, конвейер рисования, операции со страницами, отмена
├─ canvas/          камера, раскладка страниц, рендер, живой слой, кэши, геометрия штрихов, фоны, текст
├─ input/           маршрутизация указателя (отсечение ладони), жесты, горячие клавиши
├─ tools/           базовый Tool и инструменты, ToolManager, выделение, линейка
├─ features/        импорт/экспорт PDF, вставка фото, сохранение файлов
├─ ui/              иконки, полка, редактор, диалоги, виджеты
└─ styles/          tokens.css (цвета, шрифты, светлая/тёмная тема) и стили по областям
tests/unit/         Vitest: замочек, геометрия, i18n, резервные копии, история, хранилище
tests/e2e/          Playwright: смоук-тест
reference/          исходный прототип (не собирается и не публикуется)
```

Правила кода — в [CLAUDE.md](CLAUDE.md).

### Безопасность

- Строгая Content-Security-Policy (`script-src 'self'`, `style-src 'self'`, `connect-src 'self'` …) без послаблений.
- Пользовательские данные никогда не попадают в `innerHTML`; разметка из строк — только статичные SVG-иконки.
- Резервные копии, фото и PDF считаются недоверенными: строгая проверка структуры, типов по сигнатуре файла и размеров; фото перекодируются в JPEG (без EXIF/GPS); pdf.js работает без скриптов, XFA и eval.
- Данные, прочитанные из IndexedDB, тоже проверяются; повреждённые записи пропускаются.

## Лицензия / License

**RU:** Код проприетарный, все права защищены. Репозиторий опубликован только для просмотра: можно смотреть исходный код и пользоваться приложением по ссылке выше для личных некоммерческих целей. Копировать, изменять, распространять или публиковать код и дизайн без письменного разрешения автора нельзя. Подробности — в [LICENSE](LICENSE).

**EN:** The code is proprietary, all rights reserved. This repository is published for viewing only: you may read the source and use the app at the link above for personal, non-commercial purposes. Copying, modifying, redistributing or publishing the code or design without written permission is not allowed. See [LICENSE](LICENSE).
