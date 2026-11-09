import * as vscode from 'vscode';
import { exec, execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { load } from './core/store';
import { sub } from './core/dispatcher';
import { watch } from './core/watcher';
import { adapterMap, Adapter } from './adapters';
import { sendToChat } from './core/inject';
import { setTeamsExtensionContext } from './teams/context';
import { signInTeams, signOutTeams } from './teams/auth';

const OPEN_COMMANDS   = ['composer.startComposerPrompt'];
const FOCUS_COMMANDS  = ['aichat.newfollowupaction', 'aichat.focus', 'composer.focusComposer'];
const CHAT_PANEL_FOCUS = ['aichat.focus', 'composer.focusComposer', 'workbench.panel.chat.view.copilot.focus'];
const SUBMIT_COMMANDS = [
  'composer.submitComposerPrompt',
  'aichat.submitFollowupAction',
  'composer.sendPrompt',
  'cursor.chat.send',
  'workbench.action.chat.submit',
  'aichat.submitChat',
  'cursor.chat.submit',
];
const SEND_KEYBIND    = 'cursor.sendKeyBinding';

export function activate(ctx: vscode.ExtensionContext) {
  console.log('[Autopilot] Extension activation started');
  setTeamsExtensionContext(ctx);

  try {
    // Register the cursorInject.send command with robust injection logic
    const cursorInjectDisposable = vscode.commands.registerCommand('cursorInject.send', async (text?: string) => {
      console.log('[cursorInject] Command executed with text:', text);
      
      // If no text provided, prompt user for input
      if (!text) {
        text = await vscode.window.showInputBox({
          prompt: 'Enter text to inject into Cursor Chat',
          placeHolder: 'Type your message here...'
        });
      }
      
      // If user cancelled or provided empty text, return
      if (!text || text.trim() === '') {
        console.log('[cursorInject] No text provided, cancelling...');
        return;
      }
      
      await injectTextToChat(text);
    });
    ctx.subscriptions.push(cursorInjectDisposable);
    console.log('[Autopilot] cursorInject.send command registered successfully');

    // Register a test command for easier testing
    const testDisposable = vscode.commands.registerCommand('autopilot.test', async () => {
      const testMessage = `Test message from Autopilot ${new Date().toLocaleTimeString()} 🚀`;
      vscode.window.showInformationMessage(`Testing injection: ${testMessage}`);
      await injectTextToChat(testMessage);
    });
    ctx.subscriptions.push(testDisposable);
    console.log('[Autopilot] autopilot.test command registered successfully');

    const teamsSignInDisposable = vscode.commands.registerCommand('autopilot.teams.signIn', async () => {
      const store = load();
      await signInTeams(store.teams ?? {});
    });
    ctx.subscriptions.push(teamsSignInDisposable);

    const teamsSignOutDisposable = vscode.commands.registerCommand('autopilot.teams.signOut', async () => {
      const store = load();
      await signOutTeams(store.teams ?? {});
    });
    ctx.subscriptions.push(teamsSignOutDisposable);

    // Load configuration (this will auto-create .autopilot.json if it doesn't exist)
    const store = load();
    console.log('[Autopilot] Configuration loaded:', JSON.stringify(store, null, 2));
    
    const actives: Adapter[] = [];

    // Check if user needs to configure adapters
    const needsConfiguration = store.adapters.some((name: string) => {
      const config = store[name];
      if (name === 'telegram') {
        return !config?.token || config.token === 'YOUR_BOT_TOKEN_HERE';
      }
      if (name === 'email') {
        return !config?.user || config.user === 'your-email@gmail.com';
      }
      if (name === 'feishu') {
        return !config?.appId || config.appId === 'cli_xxxxxxxxxxxxxxxxx';
      }
      if (name === 'teams') {
        return (
          !config?.tenantId ||
          config.tenantId === 'YOUR_TENANT_ID' ||
          !config?.clientId ||
          config.clientId === 'YOUR_CLIENT_ID' ||
          !config?.teamId ||
          config.teamId === 'YOUR_TEAM_ID' ||
          !config?.channelId ||
          config.channelId === 'YOUR_CHANNEL_ID'
        );
      }
      return false;
    });

    if (needsConfiguration) {
      vscode.window.showWarningMessage(
        'Cursor Autopilot: Please configure your adapters in .autopilot.json to start receiving notifications.',
        'Open Config'
      ).then(selection => {
        if (selection === 'Open Config') {
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          if (workspaceFolder) {
            const configPath = workspaceFolder.uri.fsPath + '/.autopilot.json';
            vscode.workspace.openTextDocument(configPath).then(doc => {
              vscode.window.showTextDocument(doc);
            });
          }
        }
      });
    }

    store.adapters.forEach((name: string) => {
      const factory = adapterMap[name];
      if (!factory) return vscode.window.showWarningMessage(`Unknown adapter: ${name}`);
      try { 
        const adapter = factory(store[name]||{});
        actives.push(adapter);
        if (adapter.dispose) {
          ctx.subscriptions.push({ dispose: () => adapter.dispose?.() });
        }
        console.log(`[Autopilot] Adapter ${name} initialized successfully`);
      }
      catch(err){ 
        console.error(`[Autopilot] Adapter ${name} init failed:`, err);
        vscode.window.showErrorMessage(`Adapter ${name} init failed: ${err}`); 
      }
    });

    actives.forEach(a => a.onReply(r => {
      const resp = r.trim()==='1' ? 'Continue ✅' : r.trim()==='2' ? 'Stop ❌' : r;
      void sendToChat(resp).catch((e) => console.error('[Autopilot] Inject failed:', e));
    }));

    sub('summary', s => {
      if (!load().enabled) return;
      console.log('[Autopilot] Processing summary:', s);
      actives.forEach(a => a.send(s).catch(e=>console.error('[Autopilot] Send failed:',e)));
    });

    const w = watch(); 
    if (w) {
      ctx.subscriptions.push(w);
      console.log('[Autopilot] File watcher initialized');
    } else {
      console.log('[Autopilot] File watcher not initialized - no workspace folder');
    }
    
    // Show status message
    const statusMessage = needsConfiguration 
      ? `Autopilot ${store.enabled?'ON':'OFF'} | adapters: ${store.adapters.join(',')} | ⚠️ Configuration needed`
      : `Autopilot ${store.enabled?'ON':'OFF'} | adapters: ${store.adapters.join(',')} | ✅ Ready`;
    
    vscode.window.showInformationMessage(statusMessage);
    console.log('[Autopilot] Extension activation completed successfully');
    
  } catch (error) {
    console.error('[Autopilot] Extension activation failed:', error);
    vscode.window.showErrorMessage(`Cursor Autopilot activation failed: ${error}`);
  }
}

async function injectTextToChat(text: string) {
  console.log('[cursorInject] Injecting text:', text);
  
  const cmds = await vscode.commands.getCommands(true);
  
  // 1️⃣ Open composer
  console.log('[cursorInject] Opening composer...');
  for (const id of OPEN_COMMANDS) {
    if (cmds.includes(id)) {
      await vscode.commands.executeCommand(id);
      console.log(`[cursorInject] Executed: ${id}`);
      break;
    }
  }
  await delay(300);

  // 2️⃣ Focus composer
  console.log('[cursorInject] Focusing composer...');
  for (const id of FOCUS_COMMANDS) {
    if (cmds.includes(id)) {
      await vscode.commands.executeCommand(id);
      console.log(`[cursorInject] Executed: ${id}`);
      break;
    }
  }
  await delay(200);

  // 3️⃣ Paste text
  console.log('[cursorInject] Pasting text...');
  await vscode.env.clipboard.writeText(text);
  if (cmds.includes(SEND_KEYBIND)) {
    await vscode.commands.executeCommand(SEND_KEYBIND, { 
      text: process.platform === 'darwin' ? 'cmd+v' : 'ctrl+v' 
    });
  } else {
    await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
  }
  await delay(250);

  for (const id of CHAT_PANEL_FOCUS) {
    if (cmds.includes(id)) {
      await vscode.commands.executeCommand(id);
      await delay(120);
      break;
    }
  }

  // 4️⃣ Submit prompt — try in‑IDE routes first
  console.log('[cursorInject] Submitting...');
  let submitted = false;
  for (const id of SUBMIT_COMMANDS) {
    if (cmds.includes(id)) {
      await vscode.commands.executeCommand(id);
      console.log(`[cursorInject] Submitted via: ${id}`);
      submitted = true;
      break;
    }
  }

  if (!submitted && cmds.includes(SEND_KEYBIND)) {
    await vscode.commands.executeCommand(SEND_KEYBIND, {
      text: process.platform === 'darwin' ? 'cmd+enter' : 'ctrl+enter'
    });
    console.log('[cursorInject] Submitted via keybind');
    submitted = true;
  }

  if (!submitted) {
    console.log('[cursorInject] Fallback → OS‑level Cmd/Ctrl+Enter');
    await osLevelSend();
  } else if (process.platform === 'win32') {
    // Cursor on Windows often accepts paste but ignores programmatic submit; nudge with Ctrl+Enter.
    await delay(150);
    await osLevelSend();
  }
}

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function osLevelSend() {
  console.log('[cursorInject] Using OS-level fallback...');
  
  if (process.platform === 'darwin') {
    // First, bring Cursor to front
    await execPromise(`osascript -e 'tell application "Cursor" to activate'`);
    await delay(200); // Wait for app to come to front
    
    // Then send the keystroke
    await execPromise(`osascript -e 'tell application "System Events" to keystroke return using {command down}'`);
    console.log('[cursorInject] Sent Cmd+Enter via AppleScript');
  } else if (process.platform === 'linux') {
    // For Linux, we need to focus the window first
    await execPromise(`wmctrl -a "Cursor"`);
    await delay(200);
    await execPromise(`xdotool key ctrl+Return`);
    console.log('[cursorInject] Sent Ctrl+Enter via xdotool');
  } else if (process.platform === 'win32') {
  try {
      await sendWindowsChatSubmit();
      console.log('[cursorInject] Sent chat submit keys via winSubmit.ps1');
    } catch (err) {
      console.error('[cursorInject] Windows SendKeys failed:', err);
      vscode.window.showWarningMessage(
        'Autopilot pasted your Teams reply into chat but could not submit automatically. Press Ctrl+Enter to send.'
      );
    }
  } else {
    vscode.window.showWarningMessage('OS‑level fallback not implemented for this platform. Please press Enter manually.');
  }
}

function execPromise(cmd: string) {
  return new Promise<void>((resolve, reject) => {
    exec(cmd, (err) => (err ? reject(err) : resolve()));
  });
}

function execFilePromise(file: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (err) => (err ? reject(err) : resolve()));
  });
}

async function sendWindowsChatSubmit(): Promise<void> {
  const scriptInOut = path.join(__dirname, 'core', 'winSubmit.ps1');
  const scriptInSrc = path.join(__dirname, '..', 'src', 'core', 'winSubmit.ps1');
  const scriptPath = fs.existsSync(scriptInOut) ? scriptInOut : scriptInSrc;
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`winSubmit.ps1 not found (tried ${scriptInOut})`);
  }
  await execFilePromise('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
  ]);
}

const isMac = () => process.platform === 'darwin';
const sleep  = (ms:number)=>new Promise(r=>setTimeout(r,ms));

export function deactivate(){}
