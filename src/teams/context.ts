import * as vscode from 'vscode';

let extensionContext: vscode.ExtensionContext | undefined;

export function setTeamsExtensionContext(ctx: vscode.ExtensionContext): void {
  extensionContext = ctx;
}

export function getTeamsExtensionContext(): vscode.ExtensionContext {
  if (!extensionContext) {
    throw new Error('[Teams] Extension context not set — adapter loaded before activate()');
  }
  return extensionContext;
}

export function tryGetTeamsExtensionContext(): vscode.ExtensionContext | undefined {
  return extensionContext;
}
