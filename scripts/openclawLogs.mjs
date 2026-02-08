import WebSocket from "ws";

const gatewayWs = process.env.OPENCLAW_GATEWAY_WS || "ws://host.docker.internal:18789";
const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || "";

if (!gatewayToken) {
  console.error(JSON.stringify({ error: "missing gateway token" }));
  process.exit(1);
}

const timeoutMs = 10000;
let settled = false;

const ws = new WebSocket(gatewayWs, {
  headers: {
    Authorization: `Bearer ${gatewayToken}`,
    Host: "127.0.0.1:18789",
  },
});

const finish = (payload) => {
  if (settled) return;
  settled = true;
  console.log(JSON.stringify(payload));
  try { ws.close(); } catch {}
  process.exit(0);
};

const fail = (err) => {
  if (settled) return;
  settled = true;
  console.error(JSON.stringify({ error: String(err) }));
  try { ws.close(); } catch {}
  process.exit(1);
};

const sendConnect = (challenge) => {
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

const timeout = setTimeout(() => {
  fail("timeout");
}, timeoutMs);

ws.on("open", () => {
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
      requestLogs();
      return;
    }
    if (payload?.type === "res" && payload?.ok && payload?.payload?.lines) {
      clearTimeout(timeout);
      finish({ lines: payload.payload.lines || [] });
    }
  } catch {
    // ignore
  }
});

ws.on("error", (err) => {
  clearTimeout(timeout);
  fail(err);
});

ws.on("close", () => {
  clearTimeout(timeout);
  if (!settled) fail("connection closed");
});
