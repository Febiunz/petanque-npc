import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

let appInited = false;
function ensureAdmin() {
  if (appInited) return;
  // Determine projectId explicitly to avoid metadata server lookup in local/dev
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (getApps().length === 0) {
    if (!projectId) throw new Error('FIREBASE_PROJECT_ID is not set. Add it to backend/.env');
    initializeApp({ projectId });
  }
  appInited = true;
}

export async function requireAuth(req, res, next) {
  try {
    ensureAdmin();
    const auth = req.headers.authorization || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ error: 'Missing bearer token' });
    const token = m[1];
  // Token revocation checking is controlled by the CHECK_REVOKED environment variable.
  // Set CHECK_REVOKED='true' to enable revocation checking; otherwise, it is disabled (useful for development).
  const checkRevoked = process.env.CHECK_REVOKED === 'true';
  const decoded = await getAuth().verifyIdToken(token, checkRevoked);
  const name = decoded.name || decoded.displayName || (decoded.email ? decoded.email.split('@')[0] : null);
  req.user = { uid: decoded.uid, email: decoded.email || null, name };
    next();
  } catch (e) {
  console.error('requireAuth error:', e?.message || e);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
