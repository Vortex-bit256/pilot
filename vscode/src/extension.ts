import * as vscode from "vscode";
import { ChatViewProvider } from "./chatView.js";


export function activate(context: vscode.ExtensionContext): void {
  const provider = new ChatViewProvider(context.extensionUri);

  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("simple-agent.newSession", () => provider.newSession()),
    vscode.commands.registerCommand("simple-agent.cancelTask", () => provider.cancelTask()),
    vscode.commands.registerCommand("simple-agent.cycleMode", () => provider.cycleMode()),
  );
}

export function deactivate(): void {


}
