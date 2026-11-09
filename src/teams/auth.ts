import fs from 'fs';
import * as vscode from 'vscode';
import {
  AuthenticationResult,
  PublicClientApplication,
  type IPublicClientApplication,
} from '@azure/msal-node';
import { getTeamsExtensionContext } from './context';

const GRAPH_SCOPES = [
  'https://graph.microsoft.com/ChannelMessage.Send',
  'https://graph.microsoft.com/ChannelMessage.Read.All',
  'https://graph.microsoft.com/User.Read',
  'offline_access',
];

export type TeamsAuthMethod = 'browser' | 'deviceCode';

export interface TeamsAuthConfig {
  tenantId: string;
  clientId: string;
  authMethod?: TeamsAuthMethod;
  /** Optional path to a serialized MSAL token cache JSON file to import */
  externalTokenCachePath?: string;
}

function resolvePath(p: string): string {
  const profile = process.env.USERPROFILE ?? process.env.HOME ?? '';
  return p
    .replace(/%USERPROFILE%/gi, profile)
    .replace(/\$\{userProfile\}/gi, profile);
}

function cacheKey(cfg: TeamsAuthConfig): string {
  return `autopilot.teams.msal.${cfg.tenantId}.${cfg.clientId}`;
}

function createPca(cfg: TeamsAuthConfig): PublicClientApplication {
  return new PublicClientApplication({
    auth: {
      clientId: cfg.clientId,
      authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
    },
  });
}

async function loadExternalCache(
  pca: IPublicClientApplication,
  cfg: TeamsAuthConfig
): Promise<boolean> {
  const pathSetting = cfg.externalTokenCachePath?.trim();
  if (!pathSetting) {
    return false;
  }
  const filePath = resolvePath(pathSetting);
  if (!fs.existsSync(filePath)) {
    return false;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    await pca.getTokenCache().deserialize(raw);
    console.log('[Teams] Imported token cache from', filePath);
    return true;
  } catch (err) {
    console.warn('[Teams] Could not import external token cache:', err);
    return false;
  }
}

async function loadCache(
  pca: IPublicClientApplication,
  key: string,
  cfg: TeamsAuthConfig
): Promise<void> {
  const ctx = getTeamsExtensionContext();
  const raw = await ctx.secrets.get(key);
  if (raw) {
    await pca.getTokenCache().deserialize(raw);
    return;
  }
  await loadExternalCache(pca, cfg);
}

async function saveCache(pca: IPublicClientApplication, key: string): Promise<void> {
  const ctx = getTeamsExtensionContext();
  const serialized = pca.getTokenCache().serialize();
  await ctx.secrets.store(key, serialized);
}

async function trySilent(pca: PublicClientApplication): Promise<AuthenticationResult | null> {
  const accounts = await pca.getTokenCache().getAllAccounts();
  if (accounts.length === 0) {
    return null;
  }
  try {
    return await pca.acquireTokenSilent({
      account: accounts[0],
      scopes: GRAPH_SCOPES,
    });
  } catch {
    return null;
  }
}

export async function acquireTeamsToken(cfg: TeamsAuthConfig): Promise<string | null> {
  if (!cfg.tenantId || !cfg.clientId) {
    return null;
  }
  const key = cacheKey(cfg);
  const pca = createPca(cfg);
  await loadCache(pca, key, cfg);

  let result = await trySilent(pca);
  if (!result) {
    return null;
  }
  await saveCache(pca, key);
  return result.accessToken;
}

export async function signInTeams(cfg: TeamsAuthConfig): Promise<boolean> {
  if (!cfg.tenantId || cfg.tenantId === 'YOUR_TENANT_ID') {
    vscode.window.showErrorMessage('Teams: set tenantId in .autopilot.json');
    return false;
  }
  if (!cfg.clientId || cfg.clientId === 'YOUR_CLIENT_ID') {
    vscode.window.showErrorMessage('Teams: set clientId in .autopilot.json');
    return false;
  }

  const key = cacheKey(cfg);
  const pca = createPca(cfg);
  await loadCache(pca, key, cfg);

  const silent = await trySilent(pca);
  if (silent) {
    await saveCache(pca, key);
    vscode.window.showInformationMessage(`Teams: signed in as ${silent.account?.username ?? 'user'}`);
    return true;
  }

  const method = cfg.authMethod ?? 'browser';

  try {
    if (method === 'browser') {
      vscode.window.showInformationMessage(
        'Teams: opening browser for sign-in (recommended when device code is blocked by your tenant).'
      );
      const result = await pca.acquireTokenInteractive({
        scopes: GRAPH_SCOPES,
        openBrowser: async (url) => {
          await vscode.env.openExternal(vscode.Uri.parse(url));
        },
        successTemplate:
          '<h1>Signed in</h1><p>You can close this tab and return to Cursor.</p>',
        errorTemplate:
          '<h1>Sign-in failed</h1><p>Check the Cursor notification for details.</p>',
      });
      await saveCache(pca, key);
      vscode.window.showInformationMessage(
        `Teams: signed in as ${result.account?.username ?? 'user'}`
      );
      return true;
    }

    const result = await pca.acquireTokenByDeviceCode({
      scopes: GRAPH_SCOPES,
      deviceCodeCallback: (response) => {
        const channel = response.message.includes('http') ? 'Open device login' : undefined;
        vscode.window
          .showInformationMessage(`Teams sign-in: ${response.message}`, channel ?? 'OK')
          .then((pick) => {
            if (pick === 'Open device login') {
              const match = response.message.match(/https:\/\/[^\s]+/);
              if (match) {
                vscode.env.openExternal(vscode.Uri.parse(match[0]));
              }
            }
          });
        console.log('[Teams]', response.message);
      },
    });
    if (!result) {
      vscode.window.showErrorMessage('Teams sign-in failed: no token returned');
      return false;
    }
    await saveCache(pca, key);
    vscode.window.showInformationMessage(`Teams: signed in as ${result.account?.username ?? 'user'}`);
    return true;
  } catch (err) {
    const msg = String(err);
    console.error('[Teams] Sign-in failed:', err);
    if (msg.includes('53003') || msg.includes('BlockedByConditionalAccess')) {
      vscode.window.showErrorMessage(
        'Teams sign-in blocked (AADSTS53003): your tenant may block device code. ' +
          'Set teams.authMethod to "browser" in .autopilot.json and sign in again. ' +
          'See docs/TEAMS_GRAPH.md'
      );
    } else {
      vscode.window.showErrorMessage(`Teams sign-in failed: ${err}`);
    }
    return false;
  }
}

export async function signOutTeams(cfg: TeamsAuthConfig): Promise<void> {
  const key = cacheKey(cfg);
  const ctx = getTeamsExtensionContext();
  await ctx.secrets.delete(key);
  vscode.window.showInformationMessage('Teams: signed out (token cache cleared)');
}

export async function getTeamsTokenForSend(cfg: TeamsAuthConfig): Promise<string | null> {
  const token = await acquireTeamsToken(cfg);
  if (token) {
    return token;
  }
  const ok = await vscode.window.showWarningMessage(
    'Teams: not signed in. Sign in now?',
    'Sign in'
  );
  if (ok === 'Sign in') {
    const signedIn = await signInTeams(cfg);
    if (signedIn) {
      return acquireTeamsToken(cfg);
    }
  }
  return null;
}
