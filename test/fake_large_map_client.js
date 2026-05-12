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
const MAP_ID = 'hanoi_my_dinh_me_tri_large';
const TOTAL_TIMEOUT_MS = 240000;
const LARGE_ORDERS = [
  ['large_order_1', [21.0058, 105.7708], [21.0190, 105.7990]],
  ['large_order_2', [21.0069, 105.7901], [21.0270, 105.7726]],
  ['large_order_3', [21.0126, 105.7864], [21.0242, 105.7994]],
  ['large_order_4', [21.0152, 105.7696], [21.0272, 105.7939]],
  ['large_order_5', [21.0187, 105.7724], [21.0125, 105.7992]],
  ['large_order_6', [21.0278, 105.8002], [21.0109, 105.7715]],
].map(([orderId, pickup, dropoff], idx) => ({
  orderId,
  pickup,
  dropoff,
  payloadKg: 0.8 + (idx % 3) * 0.4,
  priority: idx % 2 === 0 ? 'high' : 'normal',
}));

let ws;
let simId = null;
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
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  } catch (_) {
  }
  process.exit(code);
}

function send(payload) {
  ws.send(JSON.stringify(payload));
}

function matches(message, predicate) {
  try {
    return predicate(message);
  } catch (_) {
    return false;
  }
}

function waitFor(predicate, timeoutMs, stepName) {
  const backlogIndex = backlog.findIndex((message) => matches(message, predicate));
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

function flushWaiters(message) {
  for (let i = 0; i < pending.length; i += 1) {
    const waiter = pending[i];
    if (matches(message, waiter.predicate)) {
      clearTimeout(waiter.timer);
      pending.splice(i, 1);
      waiter.resolve(message);
      return true;
    }
  }
  return false;
}

function telemetryPayload(message) {
  return message.payload || message;
}

function droneId(message) {
  const payload = message.payload || {};
  return message.droneId || payload.droneId || 'drone_1';
}

function validTelemetry(message) {
  const payload = telemetryPayload(message);
  return message.type === 'telemetry'
    && message.simId === simId
    && Array.isArray(payload.pos)
    && payload.altitude !== undefined
    && payload.status;
}

function validPlannedPath(message) {
  const payload = message.payload || message;
  return message.type === 'planned_path'
    && message.simId === simId
    && Array.isArray(payload.path)
    && Array.isArray(payload.path3d)
    && payload.path3d.length > 0;
}

function orderRuntimeMessage(message) {
  if (message.simId !== simId) return false;
  if (message.type === 'order_update') {
    const status = message.payload && message.payload.status;
    return ['assigned', 'going_to_pickup', 'picked_up', 'delivering', 'completed', 'failed'].includes(status);
  }
  if (message.type === 'order_state') {
    const orders = message.payload && message.payload.orders;
    return Array.isArray(orders) && orders.some((order) => (
      ['assigned', 'going_to_pickup', 'picked_up', 'delivering', 'completed', 'failed'].includes(order.status)
    ));
  }
  return false;
}

async function waitForWorkerIdle() {
  await waitFor(
    (message) => (
      message.type === 'worker_status'
      && (message.status === 'idle' || (message.payload && message.payload.status === 'idle'))
    ) || (
      message.type === 'connection_state' && message.workerStatus === 'idle'
    ),
    30000,
    'worker idle'
  );
}

async function runScenario() {
  await waitFor((message) => message.type === 'registered' && message.role === 'frontend', 10000, 'frontend registered');
  pass('frontend registered');
  await waitForWorkerIdle();
  pass('worker idle');

  send({
    type: 'request_start_simulation',
    payload: {
      mapId: MAP_ID,
      droneCount: 3,
      orderBatch: LARGE_ORDERS,
      autoDispatch: true,
      simulationMode: 'order_dispatch',
    },
  });

  const assigned = await waitFor((message) => message.type === 'simulation_assigned', 30000, 'large simulation assigned');
  simId = assigned.simId;
  pass('large simulation assigned');

  const config = await waitFor((message) => message.type === 'config' && message.simId === simId, 120000, 'large config');
  const bounds = config.bounds || (config.payload && config.payload.bounds);
  const buildingGeoJsonUrl = config.buildingGeoJsonUrl || (config.payload && config.payload.buildingGeoJsonUrl);
  if ((config.mapId || (config.payload && config.payload.mapId)) !== MAP_ID) {
    fail('large config mapId', 'config did not return large mapId');
  }
  if (buildingGeoJsonUrl !== `/maps/${MAP_ID}/buildings.geojson`) {
    fail('large config buildingGeoJsonUrl', `unexpected URL ${buildingGeoJsonUrl}`);
  }
  if (!bounds || !(bounds.south < bounds.north && bounds.west < bounds.east)) {
    fail('large config bounds', 'missing or invalid bounds');
  }
  pass('large config mapId/buildings/bounds');

  const telemetryDrones = new Set();
  while (telemetryDrones.size < 3) {
    const telemetry = await waitFor(validTelemetry, 120000, 'large telemetry');
    telemetryDrones.add(droneId(telemetry));
  }
  pass('large telemetry received');

  const pathDrones = new Set();
  while (pathDrones.size < 1) {
    const path = await waitFor(validPlannedPath, 120000, 'large planned path');
    pathDrones.add(droneId(path));
  }
  pass('large planned path received');

  await waitFor(orderRuntimeMessage, 120000, 'large order runtime state');
  pass('large order runtime state');

  send({ type: 'command', simId, action: 'stop' });
  await waitFor((message) => message.type === 'simulation_finished' && message.simId === simId, 60000, 'large stop');
  pass('large simulation stopped');
  cleanup(0);
}

setTimeout(() => {
  fail('large map smoke', 'total timeout');
}, TOTAL_TIMEOUT_MS);

ws = new WebSocket(WS_URL);

ws.on('open', () => {
  pass('frontend connected');
  send({ type: 'register', role: 'frontend' });
  runScenario().catch((error) => fail('large map smoke', error.message));
});

ws.on('message', (data) => {
  let message;
  try {
    message = JSON.parse(data.toString());
  } catch (_) {
    return;
  }
  if (message.type === 'ping') {
    send({ type: 'pong', timestamp: message.timestamp });
  }
  if (!flushWaiters(message)) {
    backlog.push(message);
    if (backlog.length > 200) backlog.shift();
  }
});

ws.on('error', (error) => {
  fail('frontend connected', error.message);
});

ws.on('close', () => {
  if (pending.length > 0) {
    fail('large map smoke', 'websocket closed before completion');
  }
});
