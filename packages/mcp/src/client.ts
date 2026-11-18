/**
 * BridgeClient — typed HTTP client for the backend bridge. All MCP tools call through this;
 * it is the only place the MCP server talks to the editor.
 */

import type { RpcMethod, RpcMethods } from "@reelforge/shared";

export interface BridgeClientOptions {
  port: number;
  token: string;
  host?: string;
  fetchImpl?: typeof fetch;
}

export class BridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

export class BridgeClient {
  private readonly base: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: BridgeClientOptions) {
    this.base = `http://${opts.host ?? "127.0.0.1"}:${opts.port}`;
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async rpc<M extends RpcMethod>(method: M, params: RpcMethods[M]["req"]): Promise<RpcMethods[M]["res"]> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-reelforge-token": this.token },
        body: JSON.stringify({ method, params }),
      });
    } catch (err) {
      throw new BridgeError("CONNECTION", `cannot reach ReelForge backend: ${(err as Error).message}`);
    }
    if (res.status === 401) throw new BridgeError("UNAUTHORIZED", "invalid bridge token");
    const body = (await res.json()) as
      | { ok: true; result: RpcMethods[M]["res"] }
      | { ok: false; error: { code: string; message: string } };
    if (!body.ok) throw new BridgeError(body.error.code, body.error.message);
    return body.result;
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.base}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
