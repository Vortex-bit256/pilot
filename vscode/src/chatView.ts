import * as vscode from "vscode";
import type { PermissionMode } from "../../src/protocol/index.js";
import type {
  ChatEntry,
  ChatHistoryItem,
  ChatSummary,
  FromWebviewMessage,
  ToWebviewMessage,
} from "./messages.js";
import { AgentSession } from "./session.js";

const HISTORY_KEY = "pilot.chatHistory.v1";
const MAX_CHATS = 20;
const MAX_ENTRIES_PER_CHAT = 200;


export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "pilot.chatView";

  private view: vscode.WebviewView | undefined;
  private session: AgentSession | undefined;
  private chats: ChatHistoryItem[];
  private activeChatId: string;
  private pendingAssistantText = "";

  private backlog: ToWebviewMessage[] = [];
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly state: vscode.Memento,
  ) {
    this.chats = this.loadHistory();
    if (this.chats.length === 0) {
      this.chats = [createEmptyChat()];
    }
    this.activeChatId = this.chats[0].id;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.renderHtml(webviewView.webview);

    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((message: FromWebviewMessage) => {
        void this.handleMessage(message);
      }),
    );


    for (const message of this.backlog) {
      this.post(message);
    }
    this.backlog = [];


    if (!this.session) {
      this.createSession();
    } else {
      this.postStatus();
    }
  }

  newSession(): void {
    if (this.session?.running) {
      vscode.window.showInformationMessage("Pilot: cancel the running task before starting a new chat.");
      return;
    }
    this.flushAssistantText();
    this.saveActiveAgentMessages();
    this.session?.dispose();
    const chat = createEmptyChat();
    this.chats.unshift(chat);
    this.chats = this.chats.slice(0, MAX_CHATS);
    this.activeChatId = chat.id;
    this.post({ type: "reset" });
    this.persistHistory();
    this.createSession();
    this.postHistoryState();
  }

  cancelTask(): void {
    this.session?.cancelTask();
  }

  cycleMode(): void {
    this.session?.cycleMode();
  }

  dispose(): void {
    this.session?.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private createSession(): void {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      this.post({
        type: "runFinished",
        error: "Open a workspace folder to start the agent (tools run against its root).",
      });
      return;
    }

    try {
      this.session = new AgentSession(
        (message) => this.post(message),
        root,
        this.extensionUri.fsPath,
        this.activeChat().agentMessages,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.post({ type: "runFinished", error: message });
      vscode.window.showErrorMessage(`Pilot: ${message}`);
    }
  }

  private async handleMessage(message: FromWebviewMessage): Promise<void> {
    switch (message.type) {
      case "runTask":
        this.appendEntry({ type: "user", text: message.text });
        await this.session?.runTask(message.text);
        this.saveActiveAgentMessages();
        this.persistHistory();
        this.postHistoryState();
        break;
      case "cancel":
        this.session?.cancelTask();
        break;
      case "approval":
        this.session?.resolveApproval(message.id, message.decision);
        break;
      case "setMode":
        this.session?.setMode(message.mode);
        break;
      case "newSession":
        this.newSession();
        break;
      case "selectChat":
        this.selectChat(message.id);
        break;
      case "deleteChat":
        this.deleteChat(message.id);
        break;
      case "ready":
        this.postStatus();
        this.postHistoryState();
        break;
    }
  }

  private postStatus(): void {
    if (this.session) {
      this.post({
        type: "status",
        running: this.session.running,
        mode: this.session.permissionMode as PermissionMode,
      });
    }
  }


  private post(message: ToWebviewMessage): void {
    this.recordMessage(message);
    if (this.view) {
      void this.view.webview.postMessage(message);
    } else {
      this.backlog.push(message);
    }
  }

  private selectChat(id: string): void {
    if (this.session?.running) {
      vscode.window.showInformationMessage("Pilot: cancel the running task before switching chats.");
      return;
    }
    if (id === this.activeChatId || !this.chats.some((chat) => chat.id === id)) {
      return;
    }

    this.flushAssistantText();
    this.saveActiveAgentMessages();
    this.session?.dispose();
    this.session = undefined;
    this.activeChatId = id;
    this.post({ type: "reset" });
    this.createSession();
    this.postHistoryState();
    this.persistHistory();
  }

  private deleteChat(id: string): void {
    if (this.session?.running) {
      vscode.window.showInformationMessage("Pilot: cancel the running task before deleting a chat.");
      return;
    }
    const index = this.chats.findIndex((chat) => chat.id === id);
    if (index === -1) {
      return;
    }

    this.flushAssistantText();
    this.saveActiveAgentMessages();
    this.chats.splice(index, 1);
    if (this.chats.length === 0) {
      this.chats.push(createEmptyChat());
    }
    if (id === this.activeChatId) {
      this.session?.dispose();
      this.session = undefined;
      this.activeChatId = this.chats[0].id;
      this.post({ type: "reset" });
      this.createSession();
    }
    this.persistHistory();
    this.postHistoryState();
  }

  private recordMessage(message: ToWebviewMessage): void {
    switch (message.type) {
      case "assistantDelta":
        this.pendingAssistantText += message.delta;
        break;
      case "assistantText":
        this.flushAssistantText();
        this.appendEntry({ type: "assistant", text: message.text });
        break;
      case "toolCall":
        this.flushAssistantText();
        this.appendEntry({ type: "tool", call: message.call });
        break;
      case "toolResult":
        this.updateToolEntry(message.call.id, { result: message.result });
        break;
      case "runFinished":
        this.flushAssistantText();
        if (message.error) {
          this.appendEntry({ type: "error", text: message.error });
        } else if (message.stats) {
          this.appendEntry({ type: "footer", stats: message.stats });
        }
        break;
      case "reset":
      case "status":
      case "toolProgress":
      case "approvalRequest":
      case "approvalResolved":
      case "historyState":
        break;
    }
  }

  private flushAssistantText(): void {
    const text = this.pendingAssistantText.trim();
    if (text) {
      this.appendEntry({ type: "assistant", text });
    }
    this.pendingAssistantText = "";
  }

  private appendEntry(entry: ChatEntry): void {
    const chat = this.activeChat();
    chat.entries.push(entry);
    chat.entries = chat.entries.slice(-MAX_ENTRIES_PER_CHAT);
    chat.updatedAt = Date.now();
    if (entry.type === "user" && chat.title === "New chat") {
      chat.title = summarizeTitle(entry.text);
    }
    this.sortChats();
    this.persistHistory();
  }

  private updateToolEntry(callId: string, patch: Partial<Extract<ChatEntry, { type: "tool" }>>): void {
    const chat = this.activeChat();
    for (let i = chat.entries.length - 1; i >= 0; i--) {
      const entry = chat.entries[i];
      if (entry.type === "tool" && entry.call.id === callId) {
        chat.entries[i] = { ...entry, ...patch };
        chat.updatedAt = Date.now();
        this.persistHistory();
        return;
      }
    }
  }

  private saveActiveAgentMessages(): void {
    if (!this.session) {
      return;
    }
    this.activeChat().agentMessages = this.session.snapshotMessages();
  }

  private postHistoryState(): void {
    this.post({
      type: "historyState",
      chats: this.chats.map(toSummary),
      activeChatId: this.activeChatId,
      entries: this.activeChat().entries,
    });
  }

  private activeChat(): ChatHistoryItem {
    return this.chats.find((chat) => chat.id === this.activeChatId) ?? this.chats[0];
  }

  private sortChats(): void {
    this.chats.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private loadHistory(): ChatHistoryItem[] {
    const saved = this.state.get<ChatHistoryItem[]>(HISTORY_KEY, []);
    return saved
      .filter((chat) => typeof chat.id === "string" && typeof chat.title === "string")
      .map((chat) => ({
        id: chat.id,
        title: chat.title || "New chat",
        updatedAt: typeof chat.updatedAt === "number" ? chat.updatedAt : Date.now(),
        entries: Array.isArray(chat.entries) ? chat.entries : [],
        agentMessages: Array.isArray(chat.agentMessages) ? chat.agentMessages : [],
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CHATS);
  }

  private persistHistory(): void {
    void this.state.update(HISTORY_KEY, this.chats);
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "main.js"),
    );


    const markedUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "vendor", "marked.umd.js"),
    );
    const purifyUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "vendor", "purify.min.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "main.css"),
    );
    const nonce = getNonce();

    return  `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Pilot</title>
</head>
<body>
  <header id="toolbar">
    <span class="brand">▲ Pilot</span>
    <span class="spacer"></span>
    <button id="mode-btn" class="chip" title="Permission mode (click to cycle)">safe</button>
    <button id="new-btn" class="icon-btn" title="New session">＋</button>
  </header>

  <main id="chat" aria-live="polite"></main>

  <div id="empty-state">
    <div class="logo">▲</div>
    <p>Ask the agent to inspect, change or run something in this workspace.</p>
    <p class="hint">Write/exec tool calls may ask for approval — you decide each time.</p>
  </div>

  <section id="history-panel" aria-label="Chat history">
    <div class="history-head">
      <span>Chats</span>
    </div>
    <div id="history-list"></div>
  </section>

  <footer id="composer">
    <textarea id="input" rows="1" placeholder="Describe a task…  (Enter to send, Shift+Enter for newline)"></textarea>
    <button id="send-btn" title="Send (Enter)">➤</button>
    <button id="cancel-btn" title="Cancel the running task" hidden>■</button>
  </footer>

  <script nonce="${nonce}" src="${purifyUri}"></script>
  <script nonce="${nonce}" src="${markedUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function createEmptyChat(): ChatHistoryItem {
  const now = Date.now();
  return {
    id: `chat-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: "New chat",
    updatedAt: now,
    entries: [],
    agentMessages: [],
  };
}

function toSummary(chat: ChatHistoryItem): ChatSummary {
  return {
    id: chat.id,
    title: chat.title,
    updatedAt: chat.updatedAt,
  };
}

function summarizeTitle(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 42 ? `${flat.slice(0, 42)}...` : flat || "New chat";
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
