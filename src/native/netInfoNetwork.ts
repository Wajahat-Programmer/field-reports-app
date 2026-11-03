import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

import type { Network } from '../core/ports';

/**
 * Online means "has a connection". We deliberately ignore isInternetReachable: its probe can fail on
 * networks that still reach our server, and a wrong "offline" would stop uploads for good.
 * A bad connection just fails the request and backs off.
 */
export class NetInfoNetwork implements Network {
  private online = true;
  private listeners = new Set<(online: boolean) => void>();

  constructor() {
    NetInfo.addEventListener(state => this.update(state));
    NetInfo.fetch().then(state => this.update(state));
  }

  isOnline(): boolean {
    return this.online;
  }

  subscribe(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private update(state: NetInfoState): void {
    const online = state.isConnected !== false;
    if (online !== this.online) {
      this.online = online;
      this.listeners.forEach(listener => listener(online));
    }
  }
}
