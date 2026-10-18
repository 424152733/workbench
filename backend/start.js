import { spawn } from 'node:child_process';

const target = process.argv[2];
const allowedTargets = new Set(['backend/main.js','backend/skill-runner.js']);
if (!allowedTargets.has(target)) {
  console.error('[start] Expected backend/main.js or backend/skill-runner.js.');
  process.exit(1);
}

const useEnvProxy = process.env.NODE_USE_ENV_PROXY === '1'
  && process.allowedNodeEnvironmentFlags.has('--use-env-proxy');
const runtimeArgs = useEnvProxy ? ['--use-env-proxy'] : [];
const child = spawn(process.execPath,[...runtimeArgs,target],{stdio:'inherit'});

child.once('error',(error) => {
  console.error(`[start] Could not start ${target}: ${error.message}`);
  process.exitCode = 1;
});
child.once('exit',(code,signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
process.once('SIGINT',() => child.kill('SIGINT'));
process.once('SIGTERM',() => child.kill('SIGTERM'));
