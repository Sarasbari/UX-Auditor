const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const isWin = process.platform === 'win32';

// 1. Locate the virtual environment python interpreter
const winPython = path.join(__dirname, '..', 'server', '.venv', 'Scripts', 'python.exe');
const winPythonNoExe = path.join(__dirname, '..', 'server', '.venv', 'Scripts', 'python');
const unixPython = path.join(__dirname, '..', 'server', '.venv', 'bin', 'python');

let pythonPath = unixPython;
if (isWin) {
  if (fs.existsSync(winPython)) {
    pythonPath = winPython;
  } else if (fs.existsSync(winPythonNoExe)) {
    pythonPath = winPythonNoExe;
  } else {
    // Fallback to system python if venv not found
    pythonPath = 'python';
  }
} else {
  if (fs.existsSync(unixPython)) {
    pythonPath = unixPython;
  } else {
    pythonPath = 'python3';
  }
}

console.log(`[DevOrchestrator] Starting FastAPI backend and Next.js dev server...`);
console.log(`[DevOrchestrator] Using Python interpreter: ${pythonPath}`);

// Spawn FastAPI process
const fastapi = spawn(pythonPath, ['-m', 'uvicorn', 'server.main:app', '--port', '8001'], {
  cwd: path.join(__dirname, '..'),
  stdio: 'pipe',
  shell: isWin
});

// Spawn Next.js process
const nextCmd = isWin ? 'npx.cmd' : 'npx';
const nextDev = spawn(nextCmd, ['next', 'dev'], {
  cwd: path.join(__dirname, '..'),
  stdio: 'pipe',
  shell: isWin
});

function logPrefixed(data, prefixColor, prefixText) {
  const text = data.toString();
  const lines = text.split(/\r?\n/);
  lines.forEach(line => {
    if (line.trim().length > 0) {
      console.log(`${prefixColor}${prefixText}\x1b[0m ${line}`);
    }
  });
}

fastapi.stdout.on('data', (data) => logPrefixed(data, '\x1b[36m', '[FastAPI]'));
fastapi.stderr.on('data', (data) => logPrefixed(data, '\x1b[36m', '[FastAPI]'));

nextDev.stdout.on('data', (data) => logPrefixed(data, '\x1b[32m', '[Next.js]'));
nextDev.stderr.on('data', (data) => logPrefixed(data, '\x1b[32m', '[Next.js]'));

// Handle child process exit
fastapi.on('exit', (code) => {
  console.log(`\x1b[31m[FastAPI] process exited with code ${code}\x1b[0m`);
  nextDev.kill();
  process.exit(code || 0);
});

nextDev.on('exit', (code) => {
  console.log(`\x1b[31m[Next.js] process exited with code ${code}\x1b[0m`);
  fastapi.kill();
  process.exit(code || 0);
});

// Capture Ctrl+C/SIGINT and kill children cleanly
process.on('SIGINT', () => {
  console.log('\n[DevOrchestrator] Terminating child processes...');
  fastapi.kill();
  nextDev.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[DevOrchestrator] Terminating child processes...');
  fastapi.kill();
  nextDev.kill();
  process.exit(0);
});
