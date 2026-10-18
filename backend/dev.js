import { spawn } from 'node:child_process';

let stopping = false;
const proxyRuntimeArgs = process.env.NODE_USE_ENV_PROXY === '1'
  && process.allowedNodeEnvironmentFlags.has('--use-env-proxy')
  ? ['--use-env-proxy']
  : [];
const services = [
  ['NestJS API',process.execPath,[...proxyRuntimeArgs,'backend/main.js']],
  ['Skill runner',process.execPath,[...proxyRuntimeArgs,'backend/skill-runner.js']],
  ['Vite frontend',process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1']],
];
const processes = services.map(([name,command,args]) => {
  const child = spawn(command,args,{stdio:'inherit'});
  child.once('error',(error) => {
    console.error(`[dev:all] Could not start ${name}: ${error.message}`);
    shutdown('SIGTERM',1);
  });
  child.once('exit',(code,signal) => {
    if (stopping) return;
    console.error(`[dev:all] ${name} stopped (${signal || `exit ${code}`}); stopping the remaining services.`);
    shutdown('SIGTERM',code || (signal ? 1 : 0));
  });
  return child;
});

function shutdown(signal = 'SIGTERM',exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of processes) if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  const forceTimer = setTimeout(() => {
    for (const child of processes) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  },5_000);
  forceTimer.unref();
}

process.once('SIGINT',() => shutdown('SIGINT',0));
process.once('SIGTERM',() => shutdown('SIGTERM',0));

