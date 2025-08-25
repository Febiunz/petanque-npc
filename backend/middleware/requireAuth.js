import admin from 'firebase-admin';

let appInited = false;
function ensureAdmin() {
  if (!appInited) {
    try {
      // For verifyIdToken, explicit credentials are not required; we can init with defaults.
      admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'petanque-npc' });
    } catch {}
    appInited = true;
  }
}

export async function requireAuth(req, res, next) {
  try {
    ensureAdmin();
    const auth = req.headers.authorization || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ error: 'Missing bearer token' });
    const token = m[1];
  // Do not check revoked to reduce friction during development
  const decoded = await admin.auth().verifyIdToken(token);
  const name = decoded.name || decoded.displayName || (decoded.email ? decoded.email.split('@')[0] : null);
  req.user = { uid: decoded.uid, email: decoded.email || null, name };
    next();
  } catch (e) {
  try { console.error('requireAuth error:', e?.message || e); } catch {}
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
