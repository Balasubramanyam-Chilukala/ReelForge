import type { BridgeEvent, RpcMethod, RpcMethods } from "@reelforge/shared";

export interface BridgeInfo {
  port: number;
  token: string;
  host?: string;
}

/** Frontend bridge client: typed RPC over HTTP + a WebSocket event stream. */
export class BridgeClient {
  private readonly httpBase: string;
  private readonly wsBase: string;
  private readonly token: string;
  private ws?: WebSocket;

  constructor(info: BridgeInfo) {
    const host = info.host ?? "127.0.0.1";
    this.httpBase = `http://${host}:${info.port}`;
    this.wsBase = `ws://${host}:${info.port}`;
    this.token = info.token;
  }

  async rpc<M extends RpcMethod>(method: M, params: RpcMethods[M]["req"]): Promise<RpcMethods[M]["res"]> {
    const res = await fetch(`${this.httpBase}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-reelforge-token": this.token },
      body: JSON.stringify({ method, params }),
    });
    const body = (await res.json()) as
      | { ok: true; result: RpcMethods[M]["res"] }
      | { ok: false; error: { code: string; message: string } };
    if (!body.ok) throw new BridgeRpcError(body.error.code, body.error.message);
    return body.result;
  }

  connect(onEvent: (event: BridgeEvent) => void, onStatus?: (open: boolean) => void): () => void {
    const ws = new WebSocket(`${this.wsBase}/?token=${encodeURIComponent(this.token)}`);
    this.ws = ws;
    ws.onopen = () => onStatus?.(true);
    ws.onclose = () => onStatus?.(false);
    ws.onmessage = (ev) => {
      try {
        onEvent(JSON.parse(ev.data as string) as BridgeEvent);
      } catch {
        /* ignore malformed */
      }
    };
    return () => ws.close();
  }

  close(): void {
    this.ws?.close();
  }
}

export class BridgeRpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BridgeRpcError";
  }
}
