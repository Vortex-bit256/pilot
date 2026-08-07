import * as vscode from "vscode";
import type { PermissionMode } from "../../src/protocol/index.js";
import type { FromWebviewMessage, ToWebviewMessage } from "./messages.js";
import { AgentSession } from "./session.js";


export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "simple-agent.chatView";

  private view: vscode.WebviewView | undefined;
  private session: AgentSession | undefined;

  private backlog: ToWebviewMessage[] = [];
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {}

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
    this.session?.dispose();
    this.session = undefined;
    this.post({ type: "reset" });
    this.backlog = [];
    this.createSession();
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
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.post({ type: "runFinished", error: message });
      vscode.window.showErrorMessage(`Simple Agent: ${message}`);
    }
  }

  private async handleMessage(message: FromWebviewMessage): Promise<void> {
    switch (message.type) {
      case "runTask":
        await this.session?.runTask(message.text);
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
      case "ready":
        this.postStatus();
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
    if (this.view) {
      void this.view.webview.postMessage(message);
    } else {
      this.backlog.push(message);
    }
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
  <title>Simple Agent</title>
</head>
<body>
  <header id="toolbar">
    <span class="brand">⬢ simple-agent</span>
    <span class="spacer"></span>
    <button id="mode-btn" class="chip" title="Permission mode (click to cycle)">safe</button>
    <button id="new-btn" class="icon-btn" title="New session">＋</button>
  </header>

  <main id="chat" aria-live="polite"></main>

  <div id="empty-state">
    <div class="logo">⬢</div>
    <p>Ask the agent to inspect, change or run something in this workspace.</p>
    <p class="hint">Write/exec tool calls may ask for approval — you decide each time.</p>
  </div>

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

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
