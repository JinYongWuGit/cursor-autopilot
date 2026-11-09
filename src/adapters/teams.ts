import { Adapter } from '.';
import { acquireTeamsToken, getTeamsTokenForSend } from '../teams/auth';
import { getTeamsExtensionContext } from '../teams/context';
import {
  graphRequest,
  GraphChatMessage,
  GraphChatMessageList,
} from '../teams/graphClient';

export interface TeamsAdapterConfig {
  tenantId: string;
  clientId: string;
  teamId: string;
  channelId: string;
  pollIntervalSeconds?: number;
  threadMode?: 'single-root';
  authMethod?: 'browser' | 'deviceCode';
  externalTokenCachePath?: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function isPlaceholderConfig(cfg: TeamsAdapterConfig): boolean {
  return (
    !cfg.tenantId ||
    cfg.tenantId === 'YOUR_TENANT_ID' ||
    !cfg.clientId ||
    cfg.clientId === 'YOUR_CLIENT_ID' ||
    !cfg.teamId ||
    cfg.teamId === 'YOUR_TEAM_ID' ||
    !cfg.channelId ||
    cfg.channelId === 'YOUR_CHANNEL_ID'
  );
}

function anchorStateKey(cfg: TeamsAdapterConfig): string {
  return `autopilot.teams.anchor.${cfg.teamId}.${cfg.channelId}`;
}

function encodeGraphId(id: string): string {
  return encodeURIComponent(id);
}

/** Outbound summaries always include this footer (also used to ignore our own posts when polling). */
function isAutopilotOutboundText(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes('reply 1 to continue') ||
    (t.includes('summary') && t.includes('current status'))
  );
}

function trackOutboundMessage(
  msg: GraphChatMessage | undefined,
  outboundMessageIds: Set<string>,
  seenReplyIds: Set<string>
): void {
  if (!msg?.id) {
    return;
  }
  outboundMessageIds.add(msg.id);
  seenReplyIds.add(msg.id);
}

function formatSummaryHtml(s: { summary?: string; current_status?: string }): string {
  const summary = escapeHtml(s.summary ?? '');
  const status = escapeHtml(s.current_status ?? '');
  return (
    `<h3>Summary</h3><p>${summary}</p>` +
    `<h3>Current status</h3><p>${status}</p>` +
    `<p><em>Reply <strong>1</strong> to continue, <strong>2</strong> to stop, or type any instruction.</em></p>`
  );
}

export default function Teams(cfg: TeamsAdapterConfig): Adapter {
  const pollMs = Math.max(5, (cfg.pollIntervalSeconds ?? 10) * 1000);
  let replyHandler: (r: string) => void = () => {};
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let isDisposed = false;
  const seenReplyIds = new Set<string>();
  const outboundMessageIds = new Set<string>();
  let polling = false;

  const authCfg = {
    tenantId: cfg.tenantId,
    clientId: cfg.clientId,
    authMethod: cfg.authMethod,
    externalTokenCachePath: cfg.externalTokenCachePath,
  };

  if (isPlaceholderConfig(cfg)) {
    console.warn('[Teams] Placeholder config — configure .autopilot.json and sign in');
    return {
      send: async () => console.error('[Teams] Cannot send — configuration incomplete'),
      onReply: () => {},
      dispose: () => {},
    };
  }

  async function getAnchorId(): Promise<string | undefined> {
    const ctx = getTeamsExtensionContext();
    return ctx.globalState.get<string>(anchorStateKey(cfg));
  }

  async function setAnchorId(id: string): Promise<void> {
    const ctx = getTeamsExtensionContext();
    await ctx.globalState.update(anchorStateKey(cfg), id);
  }

  async function postChannelMessage(token: string, html: string): Promise<GraphChatMessage> {
    const path = `/teams/${cfg.teamId}/channels/${cfg.channelId}/messages`;
    return graphRequest<GraphChatMessage>(token, 'POST', path, {
      body: { contentType: 'html', content: html },
    });
  }

  async function postReply(token: string, anchorId: string, html: string): Promise<GraphChatMessage> {
    const path = `/teams/${cfg.teamId}/channels/${cfg.channelId}/messages/${encodeGraphId(anchorId)}/replies`;
    return graphRequest<GraphChatMessage>(token, 'POST', path, {
      body: { contentType: 'html', content: html },
    });
  }

  async function listReplies(token: string, anchorId: string): Promise<GraphChatMessage[]> {
    const path = `/teams/${cfg.teamId}/channels/${cfg.channelId}/messages/${encodeGraphId(anchorId)}/replies?$top=50`;
    const list = await graphRequest<GraphChatMessageList>(token, 'GET', path);
    return list.value ?? [];
  }

  async function pollReplies(): Promise<void> {
    if (isDisposed || polling) {
      return;
    }
    polling = true;
    try {
      const anchorId = await getAnchorId();
      if (!anchorId) {
        return;
      }
      const token = await acquireTeamsToken(authCfg);
      if (!token) {
        console.warn('[Teams] Poll skipped — no token (sign in via Cursor Autopilot: Teams Sign In)');
        return;
      }
      const replies = await listReplies(token, anchorId);
      for (const msg of replies) {
        if (!msg.id || seenReplyIds.has(msg.id)) {
          continue;
        }
        seenReplyIds.add(msg.id);
        if (outboundMessageIds.has(msg.id)) {
          continue;
        }
        // Graph posts as the signed-in user — do not skip all messages from "me".
        if (msg.from?.application && !msg.from?.user) {
          continue;
        }
        const raw = msg.body?.content ?? '';
        const text = stripHtml(raw);
        if (!text) {
          continue;
        }
        if (isAutopilotOutboundText(text)) {
          outboundMessageIds.add(msg.id);
          continue;
        }
        console.log('[Teams] Inbound reply:', text);
        replyHandler(text);
      }
    } catch (err) {
      console.error('[Teams] Poll failed:', err);
    } finally {
      polling = false;
    }
  }

  function startPolling(): void {
    if (pollTimer) {
      return;
    }
    pollTimer = setInterval(() => {
      void pollReplies();
    }, pollMs);
    void pollReplies();
    console.log(`[Teams] Polling every ${pollMs / 1000}s`);
  }

  return {
    send: async (s) => {
      if (isDisposed) {
        return;
      }
      try {
        const token = await getTeamsTokenForSend(authCfg);
        if (!token) {
          console.error('[Teams] No access token');
          return;
        }
        const html = formatSummaryHtml(s);
        let anchorId = await getAnchorId();

        if (!anchorId) {
          const created = await postChannelMessage(token, html);
          if (created.id) {
            await setAnchorId(created.id);
            trackOutboundMessage(created, outboundMessageIds, seenReplyIds);
            console.log('[Teams] Created anchor message', created.id);
          }
        } else {
          try {
            const created = await postReply(token, anchorId, html);
            trackOutboundMessage(created, outboundMessageIds, seenReplyIds);
          } catch (err) {
            console.warn('[Teams] Reply failed, creating new anchor:', err);
            const created = await postChannelMessage(token, html);
            if (created.id) {
              await setAnchorId(created.id);
              seenReplyIds.clear();
              outboundMessageIds.clear();
              trackOutboundMessage(created, outboundMessageIds, seenReplyIds);
            }
          }
        }
      } catch (err) {
        console.error('[Teams] Send failed:', err);
      }
    },

    onReply: (h) => {
      replyHandler = h;
      startPolling();
    },

    dispose: () => {
      isDisposed = true;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    },
  };
}
