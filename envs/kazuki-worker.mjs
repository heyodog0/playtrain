import readline from 'readline';

import { KazukiEnv } from './kazuki-env.mjs';

const env = new KazukiEnv();
const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

function encodeObservation(observation) {
  return Buffer.from(observation).toString('base64');
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function ok(payload) {
  send({ ok: true, ...payload });
}

function fail(error) {
  send({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

rl.on('line', (line) => {
  if (!line.trim()) return;

  try {
    const request = JSON.parse(line);

    if (request.cmd === 'reset') {
      const result = env.reset({
        seed: request.seed,
        maxSteps: request.max_steps,
      });
      ok({
        obs_b64: encodeObservation(result.observation),
        info: result.info,
      });
      return;
    }

    if (request.cmd === 'step') {
      const result = env.step(request.action);
      ok({
        obs_b64: encodeObservation(result.observation),
        reward: result.reward,
        terminated: result.terminated,
        truncated: result.truncated,
        info: result.info,
      });
      return;
    }

    if (request.cmd === 'close') {
      env.close();
      ok({ closed: true });
      rl.close();
      process.exit(0);
    }

    if (request.cmd === 'ping') {
      ok({ pong: true, action_meanings: KazukiEnv.getActionMeanings() });
      return;
    }

    throw new Error(`Unknown command: ${request.cmd}`);
  } catch (error) {
    fail(error);
  }
});

rl.on('close', () => {
  env.close();
});
