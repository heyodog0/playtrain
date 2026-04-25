import { KazukiEnv } from './kazuki-env.mjs';

const env = new KazukiEnv();
let pending = Buffer.alloc(0);
let shuttingDown = false;

function buildFrame(meta, binary = Buffer.alloc(0)) {
  const metaBuffer = Buffer.from(JSON.stringify(meta), 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt32BE(metaBuffer.length, 0);
  header.writeUInt32BE(binary.length, 4);
  return Buffer.concat([header, metaBuffer, binary]);
}

function send(meta, binary = Buffer.alloc(0), callback = undefined) {
  process.stdout.write(buildFrame(meta, binary), callback);
}

function ok(meta = {}, binary = Buffer.alloc(0), callback = undefined) {
  send({ ok: true, ...meta }, binary, callback);
}

function fail(error) {
  send({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

function handleRequest(request, binaryLength) {
  if (binaryLength !== 0) {
    throw new Error(`Unexpected binary payload for command ${request.cmd}`);
  }

  if (request.cmd === 'reset') {
    const result = env.reset({
      seed: request.seed,
      maxSteps: request.max_steps,
    });
    ok({ info: result.info }, Buffer.from(result.observation));
    return;
  }

  if (request.cmd === 'step') {
    const result = env.step(request.action);
    ok(
      {
        reward: result.reward,
        terminated: result.terminated,
        truncated: result.truncated,
        info: result.info,
      },
      Buffer.from(result.observation),
    );
    return;
  }

  if (request.cmd === 'close') {
    shuttingDown = true;
    env.close();
    ok({ closed: true }, Buffer.alloc(0), () => {
      process.stdin.pause();
      process.exit(0);
    });
    return;
  }

  if (request.cmd === 'ping') {
    ok({ pong: true, action_meanings: KazukiEnv.getActionMeanings() });
    return;
  }

  throw new Error(`Unknown command: ${request.cmd}`);
}

function processPending() {
  while (pending.length >= 8 && !shuttingDown) {
    const metaLength = pending.readUInt32BE(0);
    const binaryLength = pending.readUInt32BE(4);
    const frameLength = 8 + metaLength + binaryLength;
    if (pending.length < frameLength) return;

    const metaStart = 8;
    const metaEnd = metaStart + metaLength;
    const metaBuffer = pending.subarray(metaStart, metaEnd);
    const request = JSON.parse(metaBuffer.toString('utf8'));
    pending = pending.subarray(frameLength);

    try {
      handleRequest(request, binaryLength);
    } catch (error) {
      fail(error);
    }
  }
}

process.stdin.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  processPending();
});

process.stdin.on('end', () => {
  env.close();
});
