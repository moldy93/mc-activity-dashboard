export const runtime = "nodejs";

import { NextResponse } from "next/server";

const gatewayWs = process.env.OPENCLAW_GATEWAY_WS || "ws://host.docker.internal:18789";
const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || "";

export async function GET() {
  if (!gatewayToken) {
    return NextResponse.json({ error: "missing gateway token" }, { status: 500 });
  }

  const result = await new Promise<{ lines: string[] }>(async (resolve, reject) => {
    const { default: WebSocket } = await import("ws");
    const ws = new WebSocket(gatewayWs, {
      headers: {
        Authorization: `Bearer ${gatewayToken}`,
        Host: "127.0.0.1:18789",
      },
    });

    let connected = false;
    const timeout = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error("timeout"));
    }, 10000);

    const sendConnect = (challenge?: { nonce?: string; ts?: number }) => {
      const id = crypto.randomUUID();
      ws.send(
        JSON.stringify({
          type: "req",
          id,
          method: "connect",
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: "mc-activity-dashboard",
              version: "1.0.0",
              platform: "node",
              mode: "operator",
            },
            role: "operator",
            scopes: ["operator.read"],
            caps: [],
            commands: [],
            permissions: {},
            auth: { token: gatewayToken },
            locale: "en-US",
            userAgent: "mc-activity-dashboard/1.0.0",
            device: {
              id: "mc-activity-dashboard",
              publicKey: "",
              signature: "",
              signedAt: challenge?.ts ?? Date.now(),
              nonce: challenge?.nonce ?? "",
            },
          },
        })
      );
    };

    const requestLogs = () => {
      const id = crypto.randomUUID();
      ws.send(
        JSON.stringify({
          type: "req",
          id,
          method: "logs.tail",
          params: { cursor: 0, limit: 200, maxBytes: 200000 },
        })
      );
    };

    ws.on("open", () => {
      // Attempt connect immediately; if gateway demands a challenge, we'll retry.
      sendConnect();
    });

    ws.on("message", (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        if (payload?.type === "event" && payload?.event === "connect.challenge") {
          sendConnect(payload?.payload);
          return;
        }
        if (payload?.type === "res" && payload?.ok && payload?.payload?.type === "hello-ok") {
          connected = true;
          requestLogs();
          return;
        }
        if (payload?.type === "res" && payload?.ok && payload?.payload?.lines) {
          clearTimeout(timeout);
          const lines = payload.payload.lines || [];
          resolve({ lines });
          try { ws.close(); } catch {}
        }
      } catch (err) {
        // ignore
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    ws.on("close", () => {
      clearTimeout(timeout);
      if (!connected) {
        reject(new Error("connection closed"));
      }
    });
  });

  return NextResponse.json(result);
}
