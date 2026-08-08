
"use strict";


(function () {


  const vscode =  (acquireVsCodeApi());


  const marked =  (globalThis.marked);

  const DOMPurify =  (globalThis.DOMPurify);

  const chat =  (document.getElementById("chat"));
  const emptyState =  (document.getElementById("empty-state"));
  const input =  (document.getElementById("input"));
  const sendBtn =  (document.getElementById("send-btn"));
  const cancelBtn =  (document.getElementById("cancel-btn"));
  const modeBtn =  (document.getElementById("mode-btn"));
  const newBtn =  (document.getElementById("new-btn"));
  const historyList =  (document.getElementById("history-list"));


  let mode = "safe";

  let running = false;


  let currentTextEl = null;

  let currentTextRaw = "";


  const toolBlocks = new Map();
  let activeChatId = "";


  function send() {
    const text = input.value.trim();
    if (!text || running) return;
    hideEmptyState();
    appendUserMessage(text);
    input.value = "";
    autoGrow();
    vscode.postMessage({ type: "runTask", text });
  }

  sendBtn.addEventListener("click", send);
  cancelBtn.addEventListener("click", () => vscode.postMessage({ type: "cancel" }));
  newBtn.addEventListener("click", () => {
    chat.innerHTML = "";
    toolBlocks.clear();
    closeText();
    showEmptyState();
    vscode.postMessage({ type: "newSession" });
  });

  modeBtn.addEventListener("click", () => {
    const order =  (["safe", "work", "free"]);
    const next = order[(order.indexOf(mode) + 1) % order.length];
    vscode.postMessage({ type: "setMode", mode: next });
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });
  input.addEventListener("input", autoGrow);

  function autoGrow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  }


  window.addEventListener("message", (event) => {
    const message =  (event.data);
    switch (message.type) {
      case "assistantDelta":
        hideEmptyState();
        appendDelta(message.delta);
        break;
      case "assistantText":
        hideEmptyState();
        appendFullText(message.text);
        break;
      case "toolCall":
        hideEmptyState();
        closeText();
        addToolCall(message.call);
        break;
      case "toolProgress":
        updateToolProgress(message.call, message.progress);
        break;
      case "toolResult":
        updateToolResult(message.call, message.result);
        break;

      case "approvalRequest":
        addApprovalCard(message);
        break;
      case "approvalResolved":
        resolveApprovalCard(message.id, message.decision);
        break;
      case "runFinished":
        closeText();
        if (message.error) {
          appendError(message.error);
        } else if (message.stats) {
          appendFooter(message.stats);
        }
        break;
      case "status":
        setStatus(message.running, message.mode);
        break;
      case "reset":
        chat.innerHTML = "";
        toolBlocks.clear();
        closeText();
        showEmptyState();
        break;
      case "historyState":
        renderHistoryState(message);
        break;
    }
  });


  function appendUserMessage(text) {
    const el = document.createElement("div");
    el.className = "msg user";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    el.appendChild(bubble);
    chat.appendChild(el);
    scrollToBottom();
  }


  function appendDelta(delta) {
    if (!currentTextEl) {
      currentTextEl = createAssistantBlock();
    }
    currentTextRaw += delta;
    renderMarkdownInto(currentTextEl, currentTextRaw);
    scrollToBottom();
  }


  function appendFullText(text) {
    closeText();
    const el = createAssistantBlock();
    renderMarkdownInto(el, text);
    closeText();
    scrollToBottom();
  }

  function createAssistantBlock() {
    const el = document.createElement("div");
    el.className = "msg assistant";
    chat.appendChild(el);
    return el;
  }


  function renderMarkdownInto(el, markdown) {
    el.innerHTML = DOMPurify.sanitize(marked.parse(markdown, { breaks: true }));
  }


  function closeText() {
    currentTextEl = null;
    currentTextRaw = "";
  }


  function addToolCall(call) {
    const el = document.createElement("details");
    el.className = "tool running";
    el.dataset.callId = call.id;

    const summary = document.createElement("summary");
    const icon = document.createElement("span");
    icon.className = "tool-icon spinner";
    const name = document.createElement("span");
    name.className = "tool-name";
    name.textContent = call.name;
    const args = document.createElement("span");
    args.className = "tool-args";
    args.textContent = summarizeInput(call.input);
    summary.append(icon, name, args);


    const status = document.createElement("span");
    status.className = "tool-status";
    status.textContent = "running…";
    summary.appendChild(status);

    const body = document.createElement("pre");
    body.className = "tool-body";
    body.textContent = JSON.stringify(call.input, null, 2);

    el.append(summary, body);
    el.dataset.startedAt = String(Date.now());
    chat.appendChild(el);
    toolBlocks.set(call.id, el);
    scrollToBottom();
  }


  function updateToolProgress(call, progress) {
    const el = toolBlocks.get(call.id);
    if (!el || !el.classList.contains("running")) return;

    const status = el.querySelector(".tool-status");
    if (status) {
      status.textContent = progress.label;
    }


    if (progress.output && progress.output.length > 0) {
      const body = el.querySelector(".tool-body");
      if (body) {
        if (!el.dataset.streaming) {
          el.dataset.streaming = "1";
          body.textContent = "";
        }
        body.textContent += progress.output.join("\n") + "\n";

        const lines = body.textContent.split("\n");
        if (lines.length > 300) {
          body.textContent = lines.slice(lines.length - 300).join("\n");
        }
        body.scrollTop = body.scrollHeight;
      }
    }
    scrollToBottom();
  }


  function updateToolResult(call, result) {
    const el = toolBlocks.get(call.id);
    if (!el) return;
    el.classList.remove("running");
    el.classList.add(result.isError ? "error" : "ok");

    const icon = el.querySelector(".tool-icon");
    if (icon) {
      icon.classList.remove("spinner");
      icon.textContent = result.isError ? "✗" : "✓";
    }


    const status = el.querySelector(".tool-status");
    if (status) {
      const startedAt = Number(el.dataset.startedAt ?? 0);
      const seconds = startedAt ? (Date.now() - startedAt) / 1000 : 0;
      status.textContent = seconds >= 0.05 ? `${seconds.toFixed(1)}s` : "";
    }

    const body = el.querySelector(".tool-body");

    if (body) {
      const preview = result.content.length > 2000
        ? result.content.slice(0, 2000) + `\n… (${result.content.length} chars total)`
        : result.content;
      body.textContent = preview || "(no output)";
    }
    scrollToBottom();
  }


  function addApprovalCard(request) {
    closeText();
    const card = document.createElement("div");
    card.className = "approval";
    card.dataset.approvalId = request.id;

    const head = document.createElement("div");
    head.className = "approval-head";
    head.innerHTML =
      '<span class="warn">⚠</span> approval required · <b></b> <span class="kind"></span>';
    const nameEl = head.querySelector("b");
    if (nameEl) nameEl.textContent = request.call.name;
    const kindEl = head.querySelector(".kind");
    if (kindEl) kindEl.textContent = `(${request.kind})`;
    card.appendChild(head);

    const preview = renderPreview(request.preview);
    if (preview) card.appendChild(preview);

    const buttons = document.createElement("div");
    buttons.className = "approval-buttons";
    const choices =  ([
      ["allow", "Allow", "ok"],
      ["always", "Always", "accent"],
      ["deny", "Deny", "danger"],
    ]);
    for (const [decision, label, cls] of choices) {
      const btn = document.createElement("button");
      btn.className = `btn ${cls}`;
      btn.textContent = label;
      btn.addEventListener("click", () => {
        vscode.postMessage({ type: "approval", id: request.id, decision });
        resolveApprovalCard(request.id, decision);
      });
      buttons.appendChild(btn);
    }
    card.appendChild(buttons);

    chat.appendChild(card);
    scrollToBottom();
  }


  function resolveApprovalCard(id, decision) {
    const card = chat.querySelector(`[data-approval-id="${id}"]`);


    if (!card || card.classList.contains("resolved")) return;
    const buttons = card.querySelector(".approval-buttons");
    if (buttons) buttons.remove();
    const verdict = document.createElement("div");
    verdict.className = `verdict ${decision === "deny" ? "denied" : "allowed"}`;
    verdict.textContent =
      decision === "deny"
        ? "✗ denied"
        : decision === "always"
          ? "✓ allowed — won't be asked again this session"
          : "✓ allowed";
    card.appendChild(verdict);
    card.classList.add("resolved");
  }


  function renderPreview(preview) {
    if (!preview) return null;
    const wrap = document.createElement("div");
    wrap.className = "approval-preview";

    if (preview.kind === "diff") {
      const label = document.createElement("div");
      label.className = "preview-label";
      label.textContent = preview.path;
      wrap.appendChild(label);
      const pre = document.createElement("pre");
      pre.className = "diff";
      for (const line of preview.lines.slice(0, 60)) {
        const row = document.createElement("div");
        row.className = `diff-${line.type}`;
        row.textContent =
          line.type === "add" ? `+ ${line.text}`
          : line.type === "del" ? `- ${line.text}`
          : line.type === "gap" ? "  …"
          : `  ${line.text}`;
        pre.appendChild(row);
      }
      if (preview.lines.length > 60) {
        const more = document.createElement("div");
        more.className = "diff-gap";
        more.textContent = `  (preview truncated, ${preview.lines.length - 60} more lines)`;
        pre.appendChild(more);
      }
      wrap.appendChild(pre);
    } else if (preview.kind === "new-file") {
      const label = document.createElement("div");
      label.className = "preview-label";
      const count = preview.content.split("\n").length;
      label.textContent = `new file ${preview.path} (${count} lines)`;
      wrap.appendChild(label);
      const pre = document.createElement("pre");
      pre.className = "diff";
      for (const line of preview.content.split("\n").slice(0, 24)) {
        const row = document.createElement("div");
        row.className = "diff-add";
        row.textContent = `+ ${line}`;
        pre.appendChild(row);
      }
      wrap.appendChild(pre);
    } else if (preview.kind === "command") {
      const pre = document.createElement("pre");
      pre.className = "command";
      pre.textContent = preview.command;
      wrap.appendChild(pre);
    } else {
      const pre = document.createElement("pre");
      pre.className = "command";
      pre.textContent = preview.json;
      wrap.appendChild(pre);
    }
    return wrap;
  }


  function appendError(message) {
    const el = document.createElement("div");
    el.className = "msg error";
    el.textContent = `✗ ${message}`;
    chat.appendChild(el);
    scrollToBottom();
  }


  function appendFooter(stats) {
    const el = document.createElement("div");
    el.className = "run-footer";
    const parts = [`${stats.elapsed}s`];
    if (stats.usage) {
      parts.push(
        `↑${formatTokens(stats.usage.promptTokens)} in`,
        `↓${formatTokens(stats.usage.completionTokens)} out`,
      );
    }
    el.textContent = parts.join("  ·  ");
    chat.appendChild(el);
    scrollToBottom();
  }


  function setStatus(isRunning, newMode) {
    running = isRunning;
    mode = newMode;
    modeBtn.textContent = mode;
    modeBtn.classList.toggle("chip-danger", mode === "free");
    sendBtn.hidden = isRunning;
    cancelBtn.hidden = !isRunning;
    input.disabled = isRunning;
    historyList.classList.toggle("disabled", isRunning);
  }


  function renderHistoryState(state) {
    activeChatId = state.activeChatId;
    historyList.innerHTML = "";
    for (const item of state.chats) {
      const button = document.createElement("button");
      button.className = "history-item";
      button.classList.toggle("active", item.id === state.activeChatId);
      button.type = "button";
      button.disabled = running;
      button.title = item.title;
      button.dataset.chatId = item.id;

      const title = document.createElement("span");
      title.className = "history-title";
      title.textContent = item.title;
      const time = document.createElement("span");
      time.className = "history-time";
      time.textContent = formatHistoryTime(item.updatedAt);
      const remove = document.createElement("span");
      remove.className = "history-delete";
      remove.role = "button";
      remove.tabIndex = running ? -1 : 0;
      remove.title = "Delete chat";
      remove.textContent = "×";
      button.append(title, time, remove);

      button.addEventListener("click", () => {
        if (!running && item.id !== activeChatId) {
          vscode.postMessage({ type: "selectChat", id: item.id });
        }
      });
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!running) {
          vscode.postMessage({ type: "deleteChat", id: item.id });
        }
      });
      remove.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          if (!running) {
            vscode.postMessage({ type: "deleteChat", id: item.id });
          }
        }
      });
      historyList.appendChild(button);
    }

    chat.innerHTML = "";
    toolBlocks.clear();
    closeText();
    for (const entry of state.entries) {
      renderHistoryEntry(entry);
    }
    showEmptyState();
    scrollToBottom();
  }


  function renderHistoryEntry(entry) {
    if (entry.type === "user") {
      appendUserMessage(entry.text);
    } else if (entry.type === "assistant") {
      appendFullText(entry.text);
    } else if (entry.type === "tool") {
      addToolCall(entry.call);
      if (entry.result) {
        updateToolResult(entry.call, entry.result);
      }
    } else if (entry.type === "footer") {
      appendFooter(entry.stats);
    } else if (entry.type === "error") {
      appendError(entry.text);
    }
  }


  function summarizeInput(input) {
    const key = input.path ?? input.command;
    const text = typeof key === "string" ? key : JSON.stringify(input);
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > 80 ? flat.slice(0, 80) + "…" : flat;
  }


  function formatTokens(count) {
    return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
  }

  function formatHistoryTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function hideEmptyState() {
    emptyState.style.display = "none";
  }

  function showEmptyState() {
    emptyState.style.display = chat.children.length === 0 ? "flex" : "none";
  }

  function scrollToBottom() {


    chat.scrollTop = chat.scrollHeight;
  }


  vscode.postMessage({ type: "ready" });
})();
