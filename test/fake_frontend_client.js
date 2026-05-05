let WebSocket;

try {
  WebSocket = require('ws');
} catch (firstError) {
  try {
    WebSocket = require('../server/node_modules/ws');
  } catch (secondError) {
    console.log('[FAIL] missing ws dependency: run npm install in server');
    process.exit(1);
  }
}

const WS_URL = 'ws://localhost:8080';
const TOTAL_TIMEOUT_MS = 60000;

let ws;
let simId = null;
let lastTelemetryCount = 0;
const pending = [];
const backlog = [];

function pass(step) {
  console.log(`[PASS] ${step}`);
}

function fail(step, reason) {
  console.log(`[FAIL] ${step}: ${reason}`);
  cleanup(1);
}

function cleanup(code) {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  } catch (_) {
  }
  process.exit(code);
}

function send(payload) {
  ws.send(JSON.stringify(payload));
}

function messageMatches(message, predicate) {
  try {
    return predicate(message);
  } catch (_) {
    return false;
  }
}

function flushWaiters(message) {
  for (let i = 0; i < pending.length; i += 1) {
    const waiter = pending[i];
    if (messageMatches(message, waiter.predicate)) {
      clearTimeout(waiter.timer);
      pending.splice(i, 1);
      waiter.resolve(message);
      return true;
    }
  }
  return false;
}

function waitFor(predicate, timeoutMs, stepName) {
  const backlogIndex = backlog.findIndex((message) => messageMatches(message, predicate));
  if (backlogIndex >= 0) {
    const [message] = backlog.splice(backlogIndex, 1);
    return Promise.resolve(message);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = pending.findIndex((waiter) => waiter.resolve === resolve);
      if (idx >= 0) pending.splice(idx, 1);
      reject(new Error(`timeout waiting for ${stepName}`));
    }, timeoutMs);

    pending.push({ predicate, resolve, reject, timer });
  });
}

function telemetryPayload(message) {
  return message.payload || message;
}

function isValidTelemetry(message) {
  if (message.type !== 'telemetry') return false;
  const payload = telemetryPayload(message);
  return Boolean(
    payload
    && payload.pos
    && (payload.batteryPercent !== undefined || payload.battery !== undefined)
    && payload.altitude !== undefined
    && payload.status
  );
}

function eventCode(message) {
  return message && message.payload && message.payload.code;
}

async function runScenario() {
  await waitFor((message) => message.type === 'registered' && message.role === 'frontend', 10000, 'frontend registered');
  pass('frontend registered');

  await waitFor(
    (message) => (
      message.type === 'worker_status' && message.status === 'idle'
    ) || (
      message.type === 'connection_state' && message.workerStatus === 'idle'
    ),
    30000,
    'worker idle'
  );
  pass('worker idle');

  send({
    type: 'request_start_simulation',
    payload: {
      mapId: 'hanoi_default',
      droneCount: 1,
    },
  });

  const assigned = await waitFor((message) => message.type === 'simulation_assigned', 30000, 'simulation assigned');
  simId = assigned.simId;
  pass('simulation assigned');

  await waitFor((message) => message.type === 'config' && message.simId === simId, 60000, 'config');

  await waitFor((message) => message.simId === simId && isValidTelemetry(message), 60000, 'telemetry received');
  lastTelemetryCount += 1;
  pass('telemetry received');

  await waitFor((message) => message.type === 'planned_path' && message.simId === simId, 60000, 'planned path received');
  pass('planned path received');

  send({
    type: 'weather_update',
    simId,
    wind_dir: 90,
    wind_speed: 15,
    ambient_temp: 35,
    is_raining: true,
    payload: {
      wind_dir: 90,
      wind_speed: 15,
      ambient_temp: 35,
      is_raining: true,
    },
  });

  await waitFor(
    (message) => (
      message.type === 'event' && ['WEATHER_CHANGED', 'PATH_REPLANNED'].includes(eventCode(message))
    ) || (
      message.type === 'telemetry' && telemetryPayload(message).isRaining === true
    ),
    60000,
    'weather update accepted'
  );
  pass('weather update accepted');

  send({
    type: 'add_obstacle',
    simId,
    payload: {
      pos: [21.0285, 105.8542],
      radius: 8,
      height: 25,
      obstacleType: 'unknown',
    },
  });

  await waitFor(
    (message) => (
      message.type === 'event' && ['OBSTACLE_ADDED', 'OBSTACLE_DETECTED'].includes(eventCode(message))
    ) || (
      message.type === 'telemetry' && message.simId === simId
    ),
    60000,
    'obstacle accepted'
  );
  pass('obstacle accepted');

  send({
    type: 'command',
    simId,
    action: 'reset',
  });

  await waitFor((message) => message.type === 'telemetry' && message.simId === simId, 60000, 'reset accepted');
  pass('reset accepted');
  pass('pipeline test completed');
  cleanup(0);
}

setTimeout(() => {
  fail('pipeline test', 'total timeout');
}, TOTAL_TIMEOUT_MS);

ws = new WebSocket(WS_URL);

ws.on('open', () => {
  pass('frontend connected');
  send({
    type: 'register',
    role: 'frontend',
  });
  runScenario().catch((error) => fail('pipeline test', error.message));
});

ws.on('message', (data) => {
  let message;
  try {
    message = JSON.parse(data.toString());
  } catch (_) {
    return;
  }

  if (message.type === 'ping') {
    send({
      type: 'pong',
      timestamp: message.timestamp,
    });
  }

  if (!flushWaiters(message)) {
    backlog.push(message);
    if (backlog.length > 200) {
      backlog.shift();
    }
  }
});

ws.on('error', (error) => {
  fail('frontend connected', error.message);
});

ws.on('close', () => {
  if (pending.length > 0) {
    fail('pipeline test', 'websocket closed before completion');
  }
});
