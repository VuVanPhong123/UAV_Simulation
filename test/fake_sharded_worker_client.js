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
const TOTAL_TIMEOUT_MS = 240000;
const SAFE_POINTS = [
  [21.0142, 105.7814],
  [21.0148, 105.7854],
  [21.0162, 105.7890],
  [21.0187, 105.7894],
  [21.0194, 105.7856],
  [21.0175, 105.7815],
  [21.0129, 105.7833],
  [21.0201, 105.7876],
];

let ws;
let simId = null;
let assigned = null;
let configCount = 0;
const pending = [];
const backlog = [];
const telemetryDrones = new Set();
const pathDrones = new Set();
const observedOrders = new Map();

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

function droneId(message) {
  const payload = message.payload || {};
  return message.droneId || payload.droneId || 'drone_1';
}

function orderKey(order) {
  return order && (order.orderId || order.order_id);
}

function remember(message) {
  if (!simId || message.simId !== simId) return;
  if (message.type === 'config') configCount += 1;
  if (message.type === 'telemetry') {
    const payload = message.payload || {};
    if (payload.pos && (payload.batteryPercent !== undefined || payload.battery !== undefined)) {
      telemetryDrones.add(droneId(message));
    }
  }
  if (message.type === 'planned_path') {
    const payload = message.payload || {};
    const path3d = payload.path3d || message.path3d;
    if (Array.isArray(path3d) && path3d.length > 0) {
      pathDrones.add(droneId(message));
    }
  }
  if (message.type === 'order_update') {
    const key = orderKey(message.payload);
    if (key) observedOrders.set(key, message.payload);
  }
  if (message.type === 'order_state' && message.payload && Array.isArray(message.payload.orders)) {
    message.payload.orders.forEach((order) => {
      const key = orderKey(order);
      if (key) observedOrders.set(key, order);
    });
  }
}

function matches(message, predicate) {
  try {
    return predicate(message);
  } catch (_) {
    return false;
  }
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

function makeOrders(count) {
  return Array.from({ length: count }).map((_, idx) => ({
    orderId: `order_sharded_${idx + 1}`,
    pickup: SAFE_POINTS[idx % SAFE_POINTS.length],
    dropoff: SAFE_POINTS[(idx + 3) % SAFE_POINTS.length],
    payloadKg: 0.7 + (idx % 3) * 0.2,
    priority: idx % 2 === 0 ? 'high' : 'normal',
  }));
}

function activeOrderCount() {
  return Array.from(observedOrders.values()).filter((order) => (
    orderKey(order)
    && orderKey(order).startsWith('order_sharded_')
    && ['assigned', 'going_to_pickup', 'picked_up', 'delivering', 'completed'].includes(order.status)
  )).length;
}

function observedShardedOrderCount() {
  return Array.from(observedOrders.keys()).filter((key) => key.startsWith('order_sharded_')).length;
}

async function waitForIdleWorkers() {
  await waitFor((message) => {
    if (message.type === 'worker_list') {
      const workers = (message.payload && message.payload.workers) || [];
      return workers.filter((worker) => worker.status === 'idle').length >= 2;
    }
    return message.type === 'worker_status'
      && (message.status === 'idle' || (message.payload && message.payload.status === 'idle'));
  }, 30000, 'two workers idle');
}

async function runScenario() {
  await waitFor((message) => message.type === 'registered' && message.role === 'frontend', 10000, 'frontend registered');
  pass('frontend registered');
  await waitForIdleWorkers();
  pass('two workers idle');

  send({
    type: 'request_start_simulation',
    payload: {
      mapId: 'hanoi_my_dinh_me_tri_large',
      droneCount: 6,
      orderBatch: makeOrders(6),
      autoDispatch: true,
      simulationMode: 'order_dispatch',
    },
  });

  assigned = await waitFor((message) => message.type === 'simulation_assigned', 30000, 'sharded simulation assigned');
  simId = assigned.simId;
  if (!assigned.sharded || !Array.isArray(assigned.workerIds) || assigned.workerIds.length !== 2 || !Array.isArray(assigned.shards) || assigned.shards.length !== 2) {
    fail('sharded simulation assigned', 'assignment did not include two worker shards');
  }
  const droneSum = assigned.shards.reduce((sum, shard) => sum + Number(shard.droneCount || 0), 0);
  if (droneSum !== 6) {
    fail('sharded simulation assigned', `expected 6 drones across shards, got ${droneSum}`);
  }
  pass('sharded simulation assigned');

  await waitFor((message) => message.type === 'config' && message.simId === simId, 180000, 'single config received');
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (configCount !== 1) {
    fail('config forwarded once', `expected 1 config, got ${configCount}`);
  }
  pass('config forwarded once');

  while (telemetryDrones.size < 6) {
    await waitFor((message) => message.simId === simId && message.type === 'telemetry', 180000, 'telemetry from 6 drones');
  }
  ['drone_1', 'drone_2', 'drone_3', 'drone_4', 'drone_5', 'drone_6'].forEach((id) => {
    if (!telemetryDrones.has(id)) fail('telemetry received from 6 drones', `missing ${id}`);
  });
  pass('telemetry received from 6 drones');

  while (pathDrones.size < 4) {
    await waitFor((message) => message.simId === simId && message.type === 'planned_path', 180000, 'planned paths received');
  }
  pass('planned paths received');

  if (observedShardedOrderCount() < 6) {
    await waitFor((message) => {
      remember(message);
      return message.simId === simId
        && ['order_update', 'order_state'].includes(message.type)
        && observedShardedOrderCount() >= 6;
    }, 120000, 'merged orders from all shards');
  }
  if (observedShardedOrderCount() < 6) {
    fail('expected merged orders from all shards', `got ${observedShardedOrderCount()} unique orders`);
  }
  pass('merged orders from all shards');

  if (activeOrderCount() < 4) {
    await waitFor((message) => {
      remember(message);
      return message.simId === simId
        && ['order_update', 'order_state'].includes(message.type)
        && activeOrderCount() >= 4;
    }, 120000, 'sharded orders active');
  }
  pass('sharded orders active');

  send({
    type: 'command',
    simId,
    action: 'stop',
  });
  await waitFor(
    (message) => message.type === 'simulation_finished' && message.simId === simId,
    60000,
    'sharded stop accepted'
  );
  pass('sharded stop accepted');
  cleanup(0);
}

setTimeout(() => {
  fail('sharded pipeline test', 'total timeout');
}, TOTAL_TIMEOUT_MS);

ws = new WebSocket(WS_URL);

ws.on('open', () => {
  pass('frontend connected');
  send({ type: 'register', role: 'frontend' });
  runScenario().catch((error) => fail('sharded pipeline test', error.message));
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
  remember(message);
  if (!flushWaiters(message)) {
    backlog.push(message);
    if (backlog.length > 300) backlog.shift();
  }
});

ws.on('error', (error) => {
  fail('frontend connected', error.message);
});

ws.on('close', () => {
  if (pending.length > 0) {
    fail('sharded pipeline test', 'websocket closed before completion');
  }
});
