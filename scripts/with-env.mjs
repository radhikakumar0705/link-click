// Loads ./.env into the environment, then runs the given command.
// Usage: node scripts/with-env.mjs <command> [args...]
// Variables already set in the shell win over .env, so you can still override per run.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(process.cwd(), '.env');
if (existsSync(envFile)) {
  const shellEnv = { ...process.env };
  process.loadEnvFile(envFile);
  Object.assign(process.env, shellEnv);
} else {
  console.warn('[with-env] no .env found — see docs/WINDOWS.md step 1 or run setup.sh');
}

// shell: true joins args with spaces, so re-quote any that contain spaces
// (e.g. concurrently's "npm run dev -w ..." commands) or they get split apart.
const quote = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
const [cmd, ...args] = process.argv.slice(2);
const child = spawn([cmd, ...args.map(quote)].join(' '), { stdio: 'inherit', shell: true, env: process.env });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
