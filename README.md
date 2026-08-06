# simple-agent

MVP coding-агента на TypeScript / Node.js. Подключается к DeepSeek API (OpenAI-совместимый) по API-ключу,
поддерживает tool-calling (чтение/запись/правка файлов, листинг директорий, запуск shell-команд)
и работает как интерактивный REPL или как разовая CLI-команда.

## Структура

```
src/
├── index.ts            # точка входа (REPL / one-shot режим, флаги CLI)
├── config.ts           # конфигурация (env-переменные)
├── agent/              # ядро агента
│   ├── agent.ts        # цикл агента (LLM -> tools -> LLM -> ...)
│   └── types.ts        # AgentConfig, Message, ToolCall
├── llm/                # абстракция над LLM
│   ├── provider.ts     # интерфейс LLMProvider
│   └── deepseek.ts     # реализация для DeepSeek API (OpenAI-совместимый)
├── tools/              # инструменты агента
│   ├── types.ts        # Tool, ToolDefinition, ToolResult
│   ├── index.ts        # реестр инструментов
│   ├── readFile.ts     # read_file — прочитать файл
│   ├── writeFile.ts    # write_file — создать/перезаписать файл
│   ├── editFile.ts     # edit_file — точечная замена фрагмента в файле
│   ├── listFiles.ts    # list_files — листинг директории (рекурсивно)
│   └── runCommand.ts   # run_command — выполнить shell-команду
└── cli/
    └── repl.ts         # интерактивный REPL
```

## Команды

```bash
npm install
npm run dev
npm run build
npm start
npm run typecheck
npm run debug
```

## Настройка

1. Скопировать `.env.example` в `.env` и прописать свой ключ DeepSeek (`DEEPSEEK_API_KEY`).
   Ключ также можно передать через переменную окружения — она имеет приоритет над `.env`.
2. Опционально: выбрать модель через `AGENT_MODEL` (`deepseek-chat` по умолчанию, `deepseek-reasoner` для R1),
   лимит итераций цикла через `AGENT_MAX_ITERATIONS` и подробные логи через `AGENT_DEBUG=1`.

```bash
cp .env.example .env
npm install
npm run dev
```

## Запуск из консоли

Интерактивный REPL:

```bash
npm run dev


```

Разовая задача (one-shot, ответ печатается в stdout, процесс завершается):

```bash
npm run dev -- "создай hello.js, который печатает приветствие, и запусти его"


npm run build && node dist/index.js "покажи список файлов в src"
```

Флаги CLI:

```
--debug, -d   логировать каждый ответ LLM и вызов инструментов в stderr
--help,  -h   справка
```

## Как это работает

1. `loadConfig()` загружает `.env` (встроенный `process.loadEnvFile`, Node >= 20.6) и валидирует конфигурацию —
   без ключа приложение падает сразу с понятной ошибкой.
2. `DeepSeekProvider.chat()` вызывает `chat.completions` DeepSeek через OpenAI SDK и мапит ответ
   (текст + `tool_calls`) во внутренний `LLMResponse`.
3. `Agent.run()` крутит цикл: LLM -> выполнение инструментов -> результат обратно в LLM, пока модель не даст
   финальный ответ или не кончится лимит итераций. Ошибка любого инструмента не роняет цикл,
   а возвращается модели как `Error: ...`, чтобы она могла скорректировать действия.
4. `repl.ts` принимает ввод пользователя, печатает ответы агента и не падает на ошибках API.

## Отладка

### 1. Подробные логи (самый быстрый способ)

```bash
npm run dev -- --debug "твоя задача"
AGENT_DEBUG=1 npm run dev
```

Логи идут в stderr и не смешиваются с ответом агента: каждая итерация цикла,
`stopReason` от модели, все вызовы инструментов с аргументами и их результаты (обрезанные до 300 символов).
В debug-режиме фатальные ошибки печатаются со stack trace.

### 2. Отладчик VS Code (точки останова)

В проекте есть `.vscode/launch.json` с тремя конфигурациями:

- **Debug agent (REPL)** — F5, агент запускается во встроенном терминале, брейкпоинты в `src/*.ts` работают
  из коробки (tsx сам подключает source maps).
- **Debug agent (one-shot)** — то же, но с разовой задачей и включённым `--debug`
  (текст задачи правится в `runtimeArgs`).
- **Attach to agent** — подключение к уже запущенному процессу.

### 3. Chrome DevTools / ручной attach

```bash
npm run debug
```

Процесс встанет на паузу в самом начале. Дальше либо открыть `chrome://inspect` в Chrome и нажать
"inspect" у процесса, либо в VS Code запустить конфигурацию **Attach to agent** (порт 9229).

### 4. Отладка собранной версии

В `tsconfig.json` включён `sourceMap: true`, поэтому для `dist/` тоже работают брейкпоинты
по исходным `.ts`-файлам:

```bash
npm run build
node --inspect-brk dist/index.js
```

### Типичные проблемы

| Симптом | Причина / решение |
|---|---|
| `DEEPSEEK_API_KEY is not set` | Нет `.env` или ключа в окружении — см. «Настройка» |
| `DeepSeek API error (HTTP 401)` | Невалидный ключ |
| `DeepSeek API error (HTTP 402)` | Кончился баланс DeepSeek |
| Агент крутится без ответа | Смотри логи с `--debug`: какие инструменты вызываются и что возвращают |
| Брейкпоинты "серые" в VS Code | Запускай через конфигурации из launch.json, не через обычный терминал |
