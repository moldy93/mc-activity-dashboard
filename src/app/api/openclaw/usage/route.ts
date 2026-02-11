export const runtime = "nodejs";

import { NextResponse } from "next/server";
import WebSocket from "ws";
import crypto from "crypto";
import fs from "fs";
import path from "path";

type UsageWindow = {
  label: string;
  usedPercent: number;
  resetAt?: number;
};

type UsageProvider = {
  provider: string;
  displayName?: string;
  plan?: string;
  windows?: UsageWindow[];
};

const gatewayWs = process.env.OPENCLAW_GATEWAY_WS || "ws://host.docker.internal:18789";
const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || "";
const deviceFile =
  process.env.OPENCLAW_DEVICE_FILE || path.join(process.cwd(), ".openclaw-device.json");

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const base64UrlEncode = (buf: Buffer) =>
  buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");

const derivePublicKeyRaw = (publicKeyPem: string) => {
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

const fingerprintPublicKey = (publicKeyPem: string) =>
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
      if (parsed?.deviceId && parsed?.publicKeyPem && parsed?.privateKeyPem) {
        return {
          deviceId: parsed.deviceId,
          publicKeyPem: parsed.publicKeyPem,
          privateKeyPem: parsed.privateKeyPem,
        };
      }
    }
  } catch {
    // ignore and regenerate
  }

  const identity = generateIdentity();
  try {
    fs.writeFileSync(deviceFile, JSON.stringify(identity, null, 2), { mode: 0o600 });
  } catch {
    // ignore if write fails; still usable in-memory for this request
  }
  return identity;
};

const buildDeviceAuthPayload = (params: {
  deviceId: string;
  signedAtMs: number;
  token: string;
  nonce: string;
}) => {
  const clientId = "gateway-client";
  const clientMode = "backend";
  const role = "operator";
  const scopes = "operator.read";
  return [
    "v2",
    params.deviceId,
    clientId,
    clientMode,
    role,
    scopes,
    String(params.signedAtMs),
    params.token,
    params.nonce,
  ].join("|");
};

const signDevicePayload = (privateKeyPem: string, payload: string) => {
  const key = crypto.createPrivateKey(privateKeyPem);
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, "utf8"), key));
};

const publicKeyRawBase64UrlFromPem = (publicKeyPem: string) =>
  base64UrlEncode(derivePublicKeyRaw(publicKeyPem));

async function fetchUsageFromGateway() {
  if (!gatewayToken) throw new Error("OPENCLAW_GATEWAY_TOKEN missing");

  return await new Promise<{ updatedAt?: number; providers?: UsageProvider[] }>((resolve, reject) => {
    const ws = new WebSocket(gatewayWs, {
      headers: {
        Authorization: `Bearer ${gatewayToken}`,
        Host: "127.0.0.1:18789",
      },
    });

    const identity = loadOrCreateDeviceIdentity();
    const timeout = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      reject(new Error("usage gateway timeout"));
    }, 10000);

    ws.on("message", (raw: any) => {
      try {
        const payload = JSON.parse(raw.toString());

        if (payload?.type === "event" && payload?.event === "connect.challenge") {
          const nonce = payload?.payload?.nonce || "";
          const signedAt = Date.now();
          const signaturePayload = buildDeviceAuthPayload({
            deviceId: identity.deviceId,
            signedAtMs: signedAt,
            token: gatewayToken,
            nonce,
          });

          ws.send(
            JSON.stringify({
              type: "req",
              id: crypto.randomUUID(),
              method: "connect",
              params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                  id: "gateway-client",
                  displayName: "mc-activity-dashboard",
                  version: "1.0.0",
                  platform: "node",
                  mode: "backend",
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
                  id: identity.deviceId,
                  publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
                  signature: signDevicePayload(identity.privateKeyPem, signaturePayload),
                  signedAt,
                  nonce,
                },
              },
            })
          );
          return;
        }

        if (payload?.type === "res" && payload?.ok && payload?.payload?.type === "hello-ok") {
          ws.send(
            JSON.stringify({
              type: "req",
              id: crypto.randomUUID(),
              method: "usage.status",
              params: {},
            })
          );
          return;
        }

        if (payload?.type === "res" && payload?.ok && payload?.payload?.providers) {
          clearTimeout(timeout);
          try {
            ws.close();
          } catch {}
          resolve(payload.payload);
          return;
        }

        if (payload?.type === "res" && payload?.ok && payload?.payload?.type !== "hello-ok") {
          clearTimeout(timeout);
          try {
            ws.close();
          } catch {}
          resolve(payload.payload || {});
          return;
        }

        if (payload?.type === "res" && !payload?.ok) {
          clearTimeout(timeout);
          try {
            ws.close();
          } catch {}
          reject(new Error(payload?.error?.message || "usage.status failed"));
        }
      } catch (error) {
        clearTimeout(timeout);
        try {
          ws.close();
        } catch {}
        reject(error instanceof Error ? error : new Error("usage parse failed"));
      }
    });

    ws.on("error", (error: any) => {
      clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error("usage ws failed"));
    });
  });
}

export async function GET() {
  try {
    const usage = await fetchUsageFromGateway();
    const codexProvider =
      (usage.providers || []).find((p) => String(p.provider || "").toLowerCase().includes("codex")) ||
      (usage.providers || [])[0];

    return NextResponse.json({
      updatedAt: usage.updatedAt,
      provider: codexProvider || null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Usage fetch failed" },
      { status: 500 }
    );
  }
}
