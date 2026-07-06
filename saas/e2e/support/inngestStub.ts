import { appendFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { INNGEST_EVENTS_FILE, INNGEST_PORT } from './env';

/**
 * Minimal Inngest event-ingest stub. The app's `inngest.send()` POSTs events
 * to `${INNGEST_BASE_URL}/e/${INNGEST_EVENT_KEY}`; we 200 everything and log
 * the payloads so tests can assert an event was emitted.
 */
export function startInngestStub(): Promise<Server> {
  rmSync(INNGEST_EVENTS_FILE, { force: true });
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'POST') {
        appendFileSync(INNGEST_EVENTS_FILE, `${JSON.stringify({ url: req.url, body })}\n`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ids: ['e2e-event-id'], status: 200 }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  return new Promise((resolve) => server.listen(INNGEST_PORT, '127.0.0.1', () => resolve(server)));
}
