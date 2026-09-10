// §12.3 — console (leader) → stage (follower). Same browser, same profile, same machine.
//
// Frames carry epoch anchors only (R5): `startedAtMono` is meaningless in another
// document, so the follower re-bases every anchor against its own monotonic clock
// and derives its own 60fps display. Nothing is ever sent per frame.

import type { Lang, RoundConfig } from '../domain/config';
import { getLang, setLang } from '../i18n/useLang';
import { readLinkFrame, writeLinkFrame } from './persist';
import type { StageFrame } from './rebase';
import { toStageFrame } from './rebase';
import { adoptPlan, applyFrame, getSession, setFollower, subscribe } from './store';
import type { RunPlan } from './state';

export const CHANNEL_NAME = 'debate-timer.v3';
export const HEARTBEAT_MS = 1000;
export const LINK_TIMEOUT_MS = 3000;

/** The stage needs the config to render names and colours; it is sent once per
 *  configHash rather than on every frame. */
export interface ConfigPayload {
  configHash: string;
  config: RoundConfig;
}

export type Message =
  | { k: 'FRAME'; frame: StageFrame; lang: Lang }
  | { k: 'CONFIG'; payload: ConfigPayload }
  | { k: 'HELLO' }
  | { k: 'NEED_CONFIG'; configHash: string }
  | { k: 'BYE' };

export type LinkStatus = 'unsupported' | 'waiting' | 'up' | 'lost';

export interface FollowerHandlers {
  /** Turn the leader's config into a plan for this document. Without it the stage
   *  still runs, but on the plan it already has. */
  buildPlan?(config: RoundConfig): RunPlan;
  onFrame?(frame: StageFrame): void;
  onStatus?(status: LinkStatus): void;
}

// ------------------------------------------------------------------ transport

interface Transport {
  post(msg: Message): void;
  close(): void;
}

function hasBroadcastChannel(): boolean {
  return typeof BroadcastChannel === 'function';
}

export function isSupported(): boolean {
  return hasBroadcastChannel() || typeof window !== 'undefined';
}

/** BroadcastChannel where it exists, a `storage`-event relay where it does not,
 *  and a silent no-op when neither is available. */
function openTransport(onMessage: (msg: Message) => void): Transport {
  if (hasBroadcastChannel()) {
    let opened: BroadcastChannel | null = null;
    try {
      opened = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      opened = null;
    }
    if (opened) {
      const channel = opened;
      channel.onmessage = (ev: MessageEvent) => {
        const data = ev.data as Message | undefined;
        if (data && typeof data.k === 'string') onMessage(data);
      };
      return {
        post: (msg) => {
          try {
            channel.postMessage(msg);
          } catch {
            /* the channel closed under us; the heartbeat surfaces it as LINK LOST */
          }
        },
        close: () => {
          channel.onmessage = null;
          try {
            channel.close();
          } catch {
            /* already closed */
          }
        },
      };
    }
  }

  if (typeof window === 'undefined') {
    return { post: () => undefined, close: () => undefined };
  }

  // Fallback: a storage key is the wire. `storage` fires in every OTHER document
  // of the origin, which is exactly the delivery a leader→follower link needs.
  const onStorage = (ev: StorageEvent): void => {
    if (ev.key !== null && !ev.key.endsWith('.link')) return;
    const raw = ev.newValue ?? readLinkFrame();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { msg?: Message };
      if (parsed.msg && typeof parsed.msg.k === 'string') onMessage(parsed.msg);
    } catch {
      /* a torn write; the next heartbeat replaces it */
    }
  };
  window.addEventListener('storage', onStorage);
  let nonce = 0;
  return {
    post: (msg) => {
      // The nonce is what makes two identical frames distinct writes, so the
      // `storage` event actually fires for a repeated heartbeat.
      nonce += 1;
      try {
        writeLinkFrame(JSON.stringify({ n: nonce, msg }));
      } catch {
        /* storage is gone too — degrade to a no-op */
      }
    },
    close: () => {
      window.removeEventListener('storage', onStorage);
    },
  };
}

// ---------------------------------------------------------------------- leader

/** The console publishes on every discrete transition plus a 1s heartbeat. */
export function startLeader(): () => void {
  let seq = 0;
  let closed = false;

  const transport = openTransport((msg) => {
    if (closed) return;
    if (msg.k === 'HELLO') sendConfig();
    else if (msg.k === 'NEED_CONFIG') sendConfig();
  });

  function publish(): void {
    seq += 1;
    const s = getSession();
    transport.post({ k: 'FRAME', frame: toStageFrame(s.state, seq), lang: getLang() });
  }

  function sendConfig(): void {
    const s = getSession();
    transport.post({
      k: 'CONFIG',
      payload: { configHash: s.state.configHash, config: s.config },
    });
    publish();
  }

  const stopStore = subscribe(publish);
  const beat = setInterval(publish, HEARTBEAT_MS);
  publish();

  return () => {
    if (closed) return;
    closed = true;
    clearInterval(beat);
    stopStore();
    transport.post({ k: 'BYE' });
    transport.close();
  };
}

// -------------------------------------------------------------------- follower

/** The stage never claims leadership — a two-leader flicker is worse than a frozen
 *  room display (§12.3). After 3s of silence it reports LINK LOST and holds the
 *  last frame it received. */
export function startFollower(handlers: FollowerHandlers = {}): () => void {
  setFollower(true);

  let status: LinkStatus = isSupported() ? 'waiting' : 'unsupported';
  let lastSeq = -1;
  let knownConfigHash: string | null = null;
  let requestedConfigHash: string | null = null;
  let lostTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  handlers.onStatus?.(status);

  function setStatus(next: LinkStatus): void {
    if (status === next) return;
    status = next;
    handlers.onStatus?.(next);
  }

  function armLostTimer(): void {
    if (lostTimer !== null) clearTimeout(lostTimer);
    lostTimer = setTimeout(() => setStatus('lost'), LINK_TIMEOUT_MS);
  }

  const transport = openTransport((msg) => {
    if (closed) return;

    if (msg.k === 'CONFIG') {
      knownConfigHash = msg.payload.configHash;
      requestedConfigHash = null;
      const build = handlers.buildPlan;
      if (build) adoptPlan(build(msg.payload.config));
      return;
    }
    if (msg.k === 'BYE') {
      setStatus('lost');
      return;
    }
    if (msg.k !== 'FRAME') return;

    // Every publish increments `seq`, so an older number is a message that
    // overtook a newer one and must be dropped rather than applied.
    if (msg.frame.seq < lastSeq) return;
    lastSeq = msg.frame.seq;

    // `knownConfigHash` only advances when the config itself lands, so a dropped
    // reply is retried on the next heartbeat instead of assumed delivered.
    const hash = msg.frame.configHash;
    if (hash !== knownConfigHash && hash !== requestedConfigHash) {
      requestedConfigHash = hash;
      transport.post({ k: 'NEED_CONFIG', configHash: hash });
    }

    if (msg.lang !== getLang()) setLang(msg.lang);

    applyFrame(msg.frame);
    handlers.onFrame?.(msg.frame);
    setStatus('up');
    armLostTimer();
  });

  transport.post({ k: 'HELLO' });
  armLostTimer();
  // A stage opened while the console was mid-write can miss the reply; ask again.
  const retry = setTimeout(() => {
    if (!closed && status !== 'up') transport.post({ k: 'HELLO' });
  }, 400);

  return () => {
    if (closed) return;
    closed = true;
    clearTimeout(retry);
    if (lostTimer !== null) clearTimeout(lostTimer);
    transport.close();
    setFollower(false);
  };
}
