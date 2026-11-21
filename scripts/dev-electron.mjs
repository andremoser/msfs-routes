import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');

const child = spawn(electronBinary, ['.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_START_URL: 'http://localhost:4200',
  },
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});
