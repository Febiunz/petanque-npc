import { spawn } from 'node:child_process';

const HEALTH_URL = process.env.API_HEALTH_URL || 'http://localhost:5000/api/health';

async function isBackendUp() {
  try {
    const res = await fetch(HEALTH_URL, { cache: 'no-store' });
    if (!res.ok) return false;
    const json = await res.json().catch(() => null);
    return Boolean(json && json.ok === true);
  } catch {
    return false;
  }
}

(async () => {
  const up = await isBackendUp();
  if (up) {
    console.log(`[smart] Backend already running at ${HEALTH_URL}`);
    process.exit(0);
  }
  console.log('[smart] Starting backend (nodemon)…');
  const child = spawn('npm', ['run', 'dev', '--prefix', 'backend'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  child.on('exit', (code) => process.exit(code ?? 0));
})();
