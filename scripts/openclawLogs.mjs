import WebSocket from "ws";

import crypto from "crypto";
import fs from "fs";
import path from "path";

const gatewayWs = process.env.OPENCLAW_GATEWAY_WS || "ws://host.docker.internal:18789";
const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || "";
const deviceFile =
  process.env.OPENCLAW_DEVICE_FILE ||
  path.join(process.cwd(), ".openclaw-device.json");

if (!gatewayToken) {
  console.error(JSON.stringify({ error: "missing gateway token" }));
  process.exit(1);
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const base64UrlEncode = (buf) =>
  buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");

const derivePublicKeyRaw = (publicKeyPem) => {
  const spki = crypto.createPublicKey(publicKeyPem).export({
    type: "spki",
    format: "der",
  });
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
};

const fingerprintPublicKey = (publicKeyPem) =>
  crypto.createHash("sha256").update(derivePublicKeyRaw(publicKeyPem)).digest("hex");

const generateIdentity = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    deviceId: fingerprintPublicKey(publicKey.export({ type: "spki", format: "pem" }).toString()),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
};

const loadOrCreateDeviceIdentity = () => {
  try {
    if (fs.existsSync(deviceFile)) {
      const parsed = JSON.parse(fs.readFileSync(deviceFile, "utf8"));
      if (parsed?.version === 1 && parsed.deviceId && parsed.publicKeyPem && parsed.privateKeyPem) {
        const derived = fingerprintPublicKey(parsed.publicKeyPem);
        if (derived && derived !== parsed.deviceId) {
          const updated = { ...parsed, deviceId: derived };
          fs.writeFileSync(deviceFile, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 });
          return { deviceId: derived, publicKeyPem: parsed.publicKeyPem, privateKeyPem: parsed.privateKeyPem };
        }
        return { deviceId: parsed.deviceId, publicKeyPem: parsed.publicKeyPem, privateKeyPem: parsed.privateKeyPem };
      }
    }
  } catch {}

  const identity = generateIdentity();
  const stored = {
    version: 1,
    deviceId: identity.deviceId,
    publicKeyPem: identity.publicKeyPem,
    privateKeyPem: identity.privateKeyPem,
    createdAtMs: Date.now(),
  };
  fs.writeFileSync(deviceFile, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  return identity;
};

const buildDeviceAuthPayload = ({ deviceId, clientId, clientMode, role, scopes, signedAtMs, token, nonce }) => {
  const version = nonce ? "v2" : "v1";
  const base = [version, deviceId, clientId, clientMode, role, scopes.join(","), String(signedAtMs), token ?? ""];
  if (version === "v2") base.push(nonce ?? "");
  return base.join("|");
};

const signDevicePayload = (privateKeyPem, payload) => {
  const key = crypto.createPrivateKey(privateKeyPem);
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, "utf8"), key));
};

const publicKeyRawBase64UrlFromPem = (publicKeyPem) => base64UrlEncode(derivePublicKeyRaw(publicKeyPem));

const timeoutMs = 10000;
const logLimit = 200;
const maxBytes = 200000;
let settled = false;

const sinceMs = Number(process.argv[2] || "0");

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
  const identity = loadOrCreateDeviceIdentity();
  const signedAt = Date.now();
  const nonce = challenge?.nonce ?? "";
  const scopes = ["operator.read"];
  const clientId = "gateway-client";
  const clientMode = "backend";
  const payload = buildDeviceAuthPayload({
    deviceId: identity.deviceId,
    clientId,
    clientMode,
    role: "operator",
    scopes,
    signedAtMs: signedAt,
    token: gatewayToken,
    nonce,
  });
  const signature = signDevicePayload(identity.privateKeyPem, payload);

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
          id: clientId,
          displayName: "mc-activity-dashboard",
          version: "1.0.0",
          platform: "node",
          mode: clientMode,
        },
        role: "operator",
        scopes,
        caps: [],
        commands: [],
        permissions: {},
        auth: { token: gatewayToken },
        locale: "en-US",
        userAgent: "mc-activity-dashboard/1.0.0",
        device: {
          id: identity.deviceId,
          publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
          signature,
          signedAt,
          nonce,
        },
      },
    })
  );
};

const requestLogs = () => {
  const id = crypto.randomUUID();
  const params = { cursor: 0, limit: logLimit, maxBytes };
  if (Number.isFinite(sinceMs) && sinceMs > 0) {
    params.sinceMs = sinceMs;
  }
  ws.send(
    JSON.stringify({
      type: "req",
      id,
      method: "logs.tail",
      params,
    })
  );
};

const timeout = setTimeout(() => {
  finish({ lines: [], timedOut: true });
}, timeoutMs);

ws.on("open", () => {
  // wait for connect.challenge event
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
