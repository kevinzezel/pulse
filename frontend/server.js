// Pulse — custom Next.js server.
//
// Used in production (NODE_ENV=production) for both HTTP and HTTPS modes.
// We need a custom server because `next start` has no flag to terminate TLS;
// adding HTTPS without giving up Next's request handling means wrapping it
// inside Node's `https.createServer`. When TLS_ENABLED is false this still
// uses `http.createServer` so behaviour matches `next start` 1:1.
//
// Cert/key paths default to $PULSE_CONFIG_ROOT/tls/{cert,key}.pem (set by the
// systemd unit / launchd plist). The `pulse config tls on` command writes
// explicit TLS_CERT_PATH/TLS_KEY_PATH into frontend.env, which take precedence.
//
// Dev mode (`next dev`) is intentionally NOT served by this file — Next dev
// has its own HMR server, and TLS in dev would cost reload speed for no gain.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const next = require('next');

const port = parseInt(process.env.WEB_PORT || '3000', 10);
const host = process.env.WEB_HOST || '127.0.0.1';
const tlsEnabled = String(process.env.TLS_ENABLED || 'false').toLowerCase() === 'true';

const configRoot = process.env.PULSE_CONFIG_ROOT
  || path.join(process.env.HOME || '', '.config', 'pulse');
const certPath = process.env.TLS_CERT_PATH || path.join(configRoot, 'tls', 'cert.pem');
const keyPath  = process.env.TLS_KEY_PATH  || path.join(configRoot, 'tls', 'key.pem');

const app = next({ dev: false, hostname: host, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const onReq = (req, res) => handle(req, res);
  if (tlsEnabled) {
    let cert, key;
    try {
      cert = fs.readFileSync(certPath);
      key  = fs.readFileSync(keyPath);
    } catch (e) {
      // Fail loudly — silent fallback to HTTP would defeat the whole point
      // of opting into TLS (the cookie's Secure flag and the browser's
      // notification permission both depend on the secure context).
      console.error(`[pulse] TLS_ENABLED=true but cert not readable: ${e.message}`);
      console.error(`[pulse] expected: ${certPath} and ${keyPath}`);
      console.error('[pulse] run: pulse config tls on   to (re)generate');
      process.exit(1);
    }
    https.createServer({ cert, key }, onReq).listen(port, host, () => {
      console.log(`> pulse dashboard ready on https://${host}:${port}`);
    });
  } else {
    http.createServer(onReq).listen(port, host, () => {
      console.log(`> pulse dashboard ready on http://${host}:${port}`);
    });
  }
}).catch((err) => {
  console.error('[pulse] next prepare() failed:', err);
  process.exit(1);
});
