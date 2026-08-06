# simple-agent

MVP coding-агента на TypeScript / Node.js. Подключается к DeepSeek API (OpenAI-совместимый) по API-ключу,
поддерживает tool-calling (чтение/запись/правка файлов, листинг директорий, запуск shell-команд)
и работает как интерактивный REPL или как разовая CLI-команда.

Ядро агента (события, инструменты, провайдеры) отделено от CLI и спроектировано под будущие клиенты
(VS Code extension, desktop, web) — см. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) и ADR в [docs/adr/](docs/adr/).

## Структура

```
src/
├── index.ts               # composition root: сборка приложения, флаги CLI
├── protocol/              # контракт core <-> клиенты (только типы, без логики)
│   ├── types.ts           # ToolCall, ToolResult, TokenUsage
│   ├── events.ts          # AgentEvent: text, text_delta, tool_call, tool_result, usage, done
│   └── commands.ts        # команды ядру (run_task, cancel_task)
├── core/                  # headless-движок: не пишет в stdout, не знает о CLI
│   ├── agent/             # цикл агента (async-генератор событий) + типы истории
│   ├── llm/               # интерфейс LLMProvider, реестр провайдеров, providers/deepseek.ts
│   ├── tools/             # defineTool (zod), ToolRegistry (источники), ToolContext, builtin/
│   └── config/            # слоистый конфиг: defaults < agent.config.json < env < CLI
└── cli/                   # клиент №1: REPL (repl.ts) + рендер событий (render.ts)
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

Конфигурация собирается по слоям (от низшего приоритета к высшему):

**defaults < `agent.config.json` в рабочей директории < переменные окружения < CLI-флаги**

| Поле | env | agent.config.json | По умолчанию |
|---|---|---|---|
| `provider` | `AGENT_PROVIDER` | `"provider"` | `deepseek` |
| `model` | `AGENT_MODEL` | `"model"` | `deepseek-chat` |
| `maxIterations` | `AGENT_MAX_ITERATIONS` | `"maxIterations"` | `20` |
| `debug` | `AGENT_DEBUG` | `"debug"` | `false` |
| `streaming` | `AGENT_STREAMING` | `"streaming"` | `true` |

Пример `agent.config.json`:

```json
{ "model": "deepseek-reasoner", "maxIterations": 40 }
```

Ключи API в конфиг не входят — ими владеют фабрики провайдеров (`DEEPSEEK_API_KEY` и т.д.).

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
--debug, -d    логировать каждое событие агента в stderr
--no-stream    не стримить токены, ждать полный ответ LLM
--help,  -h    справка
```

## Как это работает

1. `loadConfig()` загружает `.env`, накладывает слои `agent.config.json` → env → CLI-флаги
   и валидирует результат zod-схемой — невалидная конфигурация падает на старте с читаемой ошибкой.
2. `createProvider(config.provider)` берёт фабрику из реестра провайдеров; фабрика DeepSeek
   читает `DEEPSEEK_API_KEY`/`DEEPSEEK_BASE_URL` и падает с понятной ошибкой, если ключа нет.
3. `Agent.run()` — async-генератор: крутит цикл LLM -> выполнение инструментов -> результат
   обратно в LLM и по ходу отдаёт события (`text_delta`, `tool_call`, `tool_result`,
   `usage`, `done`). Ошибка любого инструмента не роняет цикл, а возвращается модели
   как `Error: ...`, чтобы она могла скорректировать действия.
4. Вход каждого инструмента валидируется zod-схемой в `ToolRegistry`; ошибка валидации
   тоже уходит модели как обычный результат инструмента.
5. `cli/repl.ts` принимает ввод пользователя, `cli/render.ts` рендерит события живьём:
   текст модели стримится по токенам, вызовы инструментов показываются строками
   `→ read_file src/index.ts` / `← ok (1.2k chars)`. С `--debug` — сырой лог событий
   в stderr, ответ в stdout. Стриминг отключается флагом `--no-stream`
   (`AGENT_STREAMING=0`, `"streaming": false`).

## Расширение

- **Новый инструмент**: файл в `src/core/tools/builtin/` через `defineTool({ name, description, kind, schema, execute })`
  + одна строка в `builtin/index.ts`. JSON Schema для LLM генерируется из zod-схемы автоматически.
- **Новый LLM-провайдер**: файл в `src/core/llm/providers/` (класс `implements LLMProvider` + фабрика)
  + одна строка в `providers/index.ts`. Выбор — `AGENT_PROVIDER` или `provider` в `agent.config.json`.

Подробности и дорожная карта: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Отладка

### 1. Подробные логи (самый быстрый способ)

```bash
npm run dev -- --debug "твоя задача"
AGENT_DEBUG=1 npm run dev
```

Логи идут в stderr и не смешиваются с ответом агента: каждое событие ядра —
текст модели, вызовы инструментов с аргументами, результаты (обрезанные до 300 символов),
расход токенов. В debug-режиме фатальные ошибки печатаются со stack trace.

### 2. Отладчик VS Code (точки останова)

В проекте есть `.vscode/launch.json` с тремя конфигурациями:

- **Debug agent (REPL)** — F5, агент запускается во встроенном терминале, брейкпоинты в `src/**` работают
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
| `Unknown LLM provider: "..."` | Опечатка в `AGENT_PROVIDER` / `provider`; ошибка покажет список доступных |
| `Invalid configuration: ...` | Невалидный `agent.config.json` или env (например, `AGENT_MAX_ITERATIONS=abc`) |
| Агент крутится без ответа | Смотри логи с `--debug`: какие инструменты вызываются и что возвращают |
| Брейкпоинты "серые" в VS Code | Запускай через конфигурации из launch.json, не через обычный терминал |
