import * as vscode from "vscode";
import { ChatViewProvider } from "./chatView.js";


export function activate(context: vscode.ExtensionContext): void {
  const provider = new ChatViewProvider(context.extensionUri, context.globalState);

  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("pilot.newSession", () => provider.newSession()),
    vscode.commands.registerCommand("pilot.cancelTask", () => provider.cancelTask()),
    vscode.commands.registerCommand("pilot.cycleMode", () => provider.cycleMode()),
  );
}

export function deactivate(): void {


}
