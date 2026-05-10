import { generateKeyPair, exportJWK, SignJWT } from "jose";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { STUB_VALID_TOKEN } from "./cache-stub";

// jose v6 dropped KeyLike in favour of WebCrypto's CryptoKey
// (server side: a node.crypto.KeyObject backed by the same
// SubtleCrypto handle). Inline the result type so we don't
// depend on jose re-exporting CryptoKey.
type GeneratedKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

/**
 * In-process OIDC IdP stub. Used by Playwright's globalSetup so
 * the OIDC E2E spec can drive a full IdP roundtrip without
 * standing up Keycloak/Auth0 in the test harness.
 *
 * Endpoints:
 *   GET /.well-known/openid-configuration → discovery doc
 *   GET /jwks                              → JWK set (1 RS256 key)
 *   GET /authorize                         → redirects back with `code`
 *   POST /token                            → returns { id_token, access_token }
 *
 * Auth model:
 *   - The IdP uses a hardcoded "session" — every operator that
 *     hits /authorize gets the same identity. No real authentication
 *     UI; the test drives the redirect directly.
 *   - The id_token + access_token are RS256-signed JWTs with `sub`,
 *     `aud`, `iss`, `exp`. The cache's OIDC verifier validates them
 *     against /jwks fetched at discovery time.
 *
 * Why not reuse the cache-stub bearer (STUB_VALID_TOKEN)?
 *   The OIDC test exercises the /v1/me path the cache stub
 *   already gates on STUB_VALID_TOKEN. To keep the gate happy
 *   while still issuing a JWT-shaped token, this stub returns
 *   STUB_VALID_TOKEN as the access_token (the cache stub doesn't
 *   verify JWT signatures — it gates on the literal string).
 *   In production, the cache's real OIDC verifier signs-checks
 *   against the IdP's JWKS; we test that path with the cache's
 *   Go-side oidc_test.go suite, not here.
 *
 * Fixed port rationale: same as cache-stub.ts — Playwright's
 * webServer inherits env at spawn time, so the AUTH_OIDC_*
 * URLs in playwright.config.ts must point at a known port.
 */

export const OIDC_STUB_PORT = 3411;
export const OIDC_STUB_ISSUER = `http://127.0.0.1:${OIDC_STUB_PORT}`;
export const OIDC_STUB_CLIENT_ID = "hypercache-monitor-test";
export const OIDC_STUB_CLIENT_SECRET = "test-client-secret";

// The identity the stub assumes every operator has logged in as.
// E2E asserts this surfaces in the topbar / iron-session shape.
export const OIDC_STUB_IDENTITY = "ops@oidc.test";

export interface OIDCStubHandle {
  issuer: string;
  clientId: string;
  clientSecret: string;
  identity: string;
  close: () => Promise<void>;
}

interface ServerState {
  privateKey: GeneratedKey;
  publicJwk: Awaited<ReturnType<typeof exportJWK>>;
  // Map of issued one-time codes to the redirect URI they were
  // bound to. `/token` validates the code matches before issuing
  // tokens — same shape as a real IdP's authorization code grant.
  codes: Map<string, { redirectUri: string; state?: string }>;
}

export async function startOIDCStub(): Promise<OIDCStubHandle> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "oidc-stub-key-1";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";

  const state: ServerState = { privateKey, publicJwk, codes: new Map() };

  const server = createServer((req, res) => {
    handle(req, res, state).catch((err) => {
      // Log + 500 so a failure surfaces in the test output rather
      // than hanging the request. Never expose internals to the
      // body — tests assert on shapes, not error strings.
      console.error("[oidc-stub] handler error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: "internal" }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(OIDC_STUB_PORT, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    issuer: OIDC_STUB_ISSUER,
    clientId: OIDC_STUB_CLIENT_ID,
    clientSecret: OIDC_STUB_CLIENT_SECRET,
    identity: OIDC_STUB_IDENTITY,
    close: () => closeServer(server),
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  state: ServerState,
): Promise<void> {
  const url = new URL(req.url ?? "/", OIDC_STUB_ISSUER);

  if (
    req.method === "GET" &&
    url.pathname === "/.well-known/openid-configuration"
  ) {
    discovery(res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/jwks") {
    jwks(res, state);
    return;
  }

  if (req.method === "GET" && url.pathname === "/authorize") {
    authorize(res, url, state);
    return;
  }

  if (req.method === "POST" && url.pathname === "/token") {
    await token(req, res, state);
    return;
  }

  if (req.method === "GET" && url.pathname === "/userinfo") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ sub: OIDC_STUB_IDENTITY, email: OIDC_STUB_IDENTITY }),
    );
    return;
  }

  // RP-initiated logout endpoint advertised in discovery. Auth.js
  // calls this on signOut() when end_session_endpoint is set; we
  // accept it and respond 200 so the best-effort logout path
  // doesn't surface as an error in the E2E.
  if (req.method === "GET" && url.pathname === "/end-session") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("logged out");
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
}

function discovery(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      issuer: OIDC_STUB_ISSUER,
      authorization_endpoint: `${OIDC_STUB_ISSUER}/authorize`,
      token_endpoint: `${OIDC_STUB_ISSUER}/token`,
      userinfo_endpoint: `${OIDC_STUB_ISSUER}/userinfo`,
      jwks_uri: `${OIDC_STUB_ISSUER}/jwks`,
      end_session_endpoint: `${OIDC_STUB_ISSUER}/end-session`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      scopes_supported: ["openid", "profile", "email"],
      token_endpoint_auth_methods_supported: [
        "client_secret_post",
        "client_secret_basic",
      ],
    }),
  );
}

function jwks(res: ServerResponse, state: ServerState): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ keys: [state.publicJwk] }));
}

function authorize(res: ServerResponse, url: URL, state: ServerState): void {
  const redirectUri = url.searchParams.get("redirect_uri");
  const responseType = url.searchParams.get("response_type");
  const requestState = url.searchParams.get("state") ?? undefined;

  if (redirectUri === null || responseType !== "code") {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_request" }));
    return;
  }

  // Mint a one-time code, bind it to the redirect_uri so /token
  // can validate the redirect_uri parameter on exchange (same
  // anti-CSRF rule a real IdP enforces).
  const code = randomCode();
  state.codes.set(code, { redirectUri, state: requestState });

  const back = new URL(redirectUri);
  back.searchParams.set("code", code);
  if (requestState !== undefined) {
    back.searchParams.set("state", requestState);
  }
  res.writeHead(302, { location: back.toString() });
  res.end();
}

async function token(
  req: IncomingMessage,
  res: ServerResponse,
  state: ServerState,
): Promise<void> {
  const body = await collectBody(req);
  const params = new URLSearchParams(body.toString("utf-8"));
  const code = params.get("code");
  const redirectUri = params.get("redirect_uri");
  const grantType = params.get("grant_type");

  if (grantType !== "authorization_code" || code === null) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_request" }));
    return;
  }

  const bound = state.codes.get(code);
  if (bound === undefined || bound.redirectUri !== redirectUri) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_grant" }));
    return;
  }
  state.codes.delete(code); // one-time use

  const now = Math.floor(Date.now() / 1000);
  const idToken = await new SignJWT({ email: OIDC_STUB_IDENTITY })
    .setProtectedHeader({ alg: "RS256", kid: "oidc-stub-key-1" })
    .setSubject(OIDC_STUB_IDENTITY)
    .setIssuer(OIDC_STUB_ISSUER)
    .setAudience(OIDC_STUB_CLIENT_ID)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(state.privateKey);

  res.writeHead(200, { "content-type": "application/json" });
  // The access_token returned to the monitor is STUB_VALID_TOKEN
  // so the existing cache-stub /v1/me probe accepts it. The
  // production cache uses the real JWT here; the cache-stub's
  // bearer comparison skips JWT verification (that's covered by
  // the cache's Go oidc_test.go suite).
  res.end(
    JSON.stringify({
      access_token: STUB_VALID_TOKEN,
      id_token: idToken,
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid profile email",
    }),
  );
}

function randomCode(): string {
  // Cryptographic randomness isn't needed for a test stub, but
  // crypto.randomUUID() is broadly available + collision-free
  // across the few codes a single E2E run mints.
  return globalThis.crypto.randomUUID();
}

function collectBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
