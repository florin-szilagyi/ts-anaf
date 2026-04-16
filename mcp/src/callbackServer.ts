import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { URL } from 'node:url';

export interface CallbackResult {
  code: string;
}

export interface CallbackServerOptions {
  port: number;
  timeoutMs?: number;
  tlsDir: string;
  stderr?: NodeJS.WritableStream;
  /** The ANAF OAuth authorization URL. The root page redirects here after cert trust. */
  authUrl: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Ensure a self-signed localhost TLS cert exists in {@link tlsDir}.
 * Returns `{ cert, key }` buffers or `null` if openssl is unavailable.
 */
export function ensureLocalhostCert(tlsDir: string): { cert: Buffer; key: Buffer } | null {
  const certPath = path.join(tlsDir, 'cert.pem');
  const keyPath = path.join(tlsDir, 'key.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      const out = execFileSync('openssl', ['x509', '-in', certPath, '-checkend', '86400'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (out.includes('Certificate will not expire')) {
        return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
      }
    } catch {
      // Cert expired or unreadable — regenerate below
    }
  }

  try {
    execFileSync('which', ['openssl'], { stdio: 'pipe' });
  } catch {
    return null;
  }

  fs.mkdirSync(tlsDir, { recursive: true });

  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      '365',
      '-nodes',
      '-subj',
      '/CN=localhost',
    ],
    { stdio: 'pipe' }
  );

  return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
}

/**
 * Start a one-shot HTTPS server that:
 * 1. Serves a root page at `/` that auto-redirects to the ANAF OAuth URL
 *    (this ensures the browser trusts the self-signed cert before ANAF redirects back)
 * 2. Waits for the OAuth callback at `/callback`, extracts the `code`, and shuts down
 *
 * Resolves with the authorization code or rejects on timeout.
 */
export function waitForCallback(opts: CallbackServerOptions): Promise<CallbackResult> {
  const { port, timeoutMs = DEFAULT_TIMEOUT_MS, tlsDir, stderr = process.stderr, authUrl } = opts;

  const tls = ensureLocalhostCert(tlsDir);
  if (!tls) {
    return Promise.reject(new Error('openssl not available'));
  }

  return new Promise<CallbackResult>((resolve, reject) => {
    const server = https.createServer({ cert: tls.cert, key: tls.key }, (req, res) => {
      const url = new URL(req.url ?? '/', `https://localhost:${port}`);
      stderr.write(`[callback-server] ${req.method} ${url.pathname}${url.search}\n`);

      // Root page: redirect to ANAF OAuth after the browser has accepted our cert
      if (url.pathname === '/') {
        stderr.write(`[callback-server] Serving redirect page -> ANAF OAuth\n`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(redirectPage(authUrl));
        return;
      }

      if (url.pathname !== '/callback') {
        stderr.write(`[callback-server] 404 - ignoring\n`);
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      // Handle ANAF error responses (e.g. ?error=access_denied)
      const error = url.searchParams.get('error');
      if (error) {
        const desc = url.searchParams.get('error_description') || error;
        stderr.write(`[callback-server] ANAF OAuth error: ${desc}\n`);
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(errorPage(`ANAF returned an error: ${desc}`));
        // Don't resolve — let the user retry or timeout
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        stderr.write(`[callback-server] Missing code parameter\n`);
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(errorPage('Missing authorization code in callback.'));
        return;
      }

      stderr.write(`[callback-server] Authorization code received!\n`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(successPage());

      cleanup();
      resolve({ code });
    });

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Callback server timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      server.close();
    }

    server.on('error', (err) => {
      cleanup();
      reject(err);
    });

    server.listen(port, () => {
      stderr.write(`Listening for OAuth callback on https://localhost:${port}/callback ...\n`);
    });
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function redirectPage(authUrl: string): string {
  // Escape the URL for safe embedding in HTML attribute
  const safeUrl = authUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>ANAF CLI - Redirecting</title>
<meta http-equiv="refresh" content="1;url=${safeUrl}">
<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f8f9fa}
.card{text-align:center;padding:2rem 3rem;border-radius:12px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.1)}
h1{color:#1565c0;margin:0 0 .5rem}p{color:#555;margin:0}a{color:#1565c0}</style></head>
<body><div class="card"><h1>Redirecting to ANAF...</h1><p>If not redirected automatically, <a href="${safeUrl}">click here</a>.</p></div></body></html>`;
}

function successPage(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>ANAF CLI</title>
<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f8f9fa}
.card{text-align:center;padding:2rem 3rem;border-radius:12px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.1)}
h1{color:#2e7d32;margin:0 0 .5rem}p{color:#555;margin:0}</style></head>
<body><div class="card"><h1>Authentication successful</h1><p>You can close this tab and return to the terminal.</p></div></body></html>`;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>ANAF CLI</title>
<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f8f9fa}
.card{text-align:center;padding:2rem 3rem;border-radius:12px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.1)}
h1{color:#c62828;margin:0 0 .5rem}p{color:#555;margin:0}</style></head>
<body><div class="card"><h1>Authentication failed</h1><p>${escapeHtml(message)}</p></div></body></html>`;
}
