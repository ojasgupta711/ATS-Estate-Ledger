// Starts the API server and the Vite client together: `npm run dev`.
// Press Ctrl+C once to stop both.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

if (!existsSync(vite)) {
  console.error('Dependencies are not installed yet. Run "npm install" first.');
  process.exit(1);
}

const procs = [
  { name: 'server', color: 36, args: [path.join(root, 'server', 'index.mjs')] },
  { name: 'client', color: 35, args: [vite, '--port', '5173', '--strictPort'] },
].map(({ name, color, args }) => {
  const child = spawn(process.execPath, args, { cwd: root, env: process.env });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on('data', (d) =>
      String(d)
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => out.write(tag + line + '\n')),
    );
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${tag}stopped${code ? ` (exit code ${code})` : ''}`);
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) if (p.exitCode === null) p.kill();
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

setTimeout(() => {
  console.log('\n  Open the app →  http://localhost:5173\n');
}, 1500);
