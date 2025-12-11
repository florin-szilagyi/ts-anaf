import express from 'express';
import { Server } from 'http';

export interface OAuthCallbackData {
  code?: string;
  error?: string;
}

export interface OAuthCallbackServer {
  app: express.Application;
  server?: Server;
  start: (port: number) => Promise<Server>;
  stop: () => void;
  setCallbackHandler: (handler: (data: OAuthCallbackData) => void) => void;
}

export function createOAuthCallbackServer(): OAuthCallbackServer {
  const app = express();
  let server: Server | undefined;
  let callbackHandler: ((data: OAuthCallbackData) => void) | null = null;

  // Callback endpoint
  app.get('/callback', (req, res) => {
    const { code, error } = req.query;

    console.log('\n📥 OAuth Callback received:', {
      code: code ? `${code.toString().substring(0, 20)}...` : 'none',
      error: error || 'none',
      timestamp: new Date().toISOString(),
    });

    const callbackData: OAuthCallbackData = {
      code: code as string | undefined,
      error: error as string | undefined,
    };

    // Call the handler if set
    if (callbackHandler) {
      callbackHandler(callbackData);
    }

    if (error) {
      console.log(`❌ OAuth error: ${error}`);
      res.status(400).send(`
        <html>
          <body>
            <h2>❌ OAuth Error</h2>
            <p>Error: ${error}</p>
            <p>You can close this window.</p>
          </body>
        </html>
      `);
      return;
    }

    if (code) {
      console.log(`✅ Authorization code captured: ${code.toString().substring(0, 20)}...`);

      res.send(`
        <html>
          <body>
            <h2>✅ Authorization Successful!</h2>
            <p>Authorization code captured successfully.</p>
            <p>You can close this window and check the test results.</p>
            <script>
              setTimeout(() => window.close(), 3000);
            </script>
          </body>
        </html>
      `);
    } else {
      console.log('❌ No authorization code in callback');
      res.status(400).send(`
        <html>
          <body>
            <h2>❌ Missing Authorization Code</h2>
            <p>No authorization code received.</p>
            <p>You can close this window.</p>
          </body>
        </html>
      `);
    }
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'OK',
      message: 'OAuth callback server is running',
      timestamp: new Date().toISOString(),
      port: server ? (server.address() as any)?.port : 'unknown',
      callbackUrl: process.env.ANAF_CALLBACK_URL,
    });
  });

  // Test endpoint to verify ngrok tunnel
  app.get('/test', (req, res) => {
    const port = server ? (server.address() as any)?.port : 'unknown';
    res.send(`
      <html>
        <body>
          <h2>✅ OAuth Callback Server Test</h2>
          <p>✅ Your ngrok tunnel is working correctly!</p>
          <p>Local server: http://localhost:${port}</p>
          <p>ANAF callback URL: ${process.env.ANAF_CALLBACK_URL || 'Not set'}</p>
          <p>Time: ${new Date().toISOString()}</p>
          <hr>
          <p><strong>Next steps:</strong></p>
          <ol>
            <li>Make sure this URL works from outside: ${process.env.ANAF_CALLBACK_URL?.replace('/callback', '/test')}</li>
            <li>Run your OAuth flow</li>
            <li>Check if the callback appears in the console</li>
          </ol>
        </body>
      </html>
    `);
  });

  return {
    app,
    start: (port: number) => {
      return new Promise((resolve, reject) => {
        server = app.listen(port, () => {
          console.log(
            `🌐 OAuth callback server running on http://localhost:${port}\n` +
              `🔗 Test URL: http://localhost:${port}/test\n` +
              `📥 Callback URL: http://localhost:${port}/callback\n` +
              `🌍 ANAF callback URL: ${process.env.ANAF_CALLBACK_URL || 'Not set'}\n` +
              `🔗 Test ngrok: ${process.env.ANAF_CALLBACK_URL?.replace('/callback', '/test') || 'N/A'}`
          );
          resolve(server!);
        });

        server.on('error', reject);
      });
    },

    stop: () => {
      if (server) {
        server.close();
        console.log('🛑 OAuth callback server stopped');
        server = undefined;
      }
    },

    setCallbackHandler: (handler: (data: OAuthCallbackData) => void) => {
      callbackHandler = handler;
    },
  };
}
