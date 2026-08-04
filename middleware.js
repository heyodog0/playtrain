// Vercel Edge Middleware: HTTP Basic Auth gate for the playtest site.
// Runs on every request before any static file is served. Defaults to
// the literal password below; set SITE_PASSWORD in the Vercel dashboard
// (Project → Settings → Environment Variables) to rotate without a commit.

export const config = {
  // Match every path. Static assets too — there's nothing to serve unauthed.
  matcher: '/:path*',
};

const REALM = 'PlayTrain playtest';
const USERNAME = 'playtest';

// The human-baseline study must be reachable WITHOUT the password: participants arrive
// from Prolific and cannot be given credentials. Everything else stays gated.
// /study/*      the participant-facing harness (tools/build-study.mjs output)
// /api/session  its ingest endpoint (api/session.js), which has its own token check
const PUBLIC_PREFIXES = ['/study', '/api/session'];

export default function middleware(req) {
  const path = new URL(req.url).pathname;
  if (PUBLIC_PREFIXES.some(p => path === p || path.startsWith(p + '/'))) return;

  const password = process.env.SITE_PASSWORD || 'grasshopper123';
  const auth = req.headers.get('authorization');

  if (auth && auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6));
      const idx = decoded.indexOf(':');
      const user = decoded.slice(0, idx);
      const pass = decoded.slice(idx + 1);
      if (user === USERNAME && pass === password) {
        return; // authorized — fall through to the static site
      }
    } catch {
      // malformed header → fall through to the 401 below
    }
  }

  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
