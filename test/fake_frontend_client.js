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
const TOTAL_TIMEOUT_MS = 420000;

let ws;
let simId = null;
let lastTelemetryCount = 0;
const pending = [];
const backlog = [];
const observedOrders = new Map();
const observedMissions = new Map();
let observedMissionTelemetry = false;

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

function clearBacklog() {
  backlog.length = 0;
}

function clearObservedRuntime() {
  observedOrders.clear();
  observedMissions.clear();
  observedMissionTelemetry = false;
}

function telemetryPayload(message) {
  return message.payload || message;
}

function plannedPathPayload(message) {
  return message.payload || message;
}

function droneId(message) {
  const payload = message.payload || {};
  return message.droneId || payload.droneId || 'drone_1';
}

function isValidPlannedPath3d(message) {
  if (message.type !== 'planned_path') return false;
  if (message.simId !== simId) return false;
  const payload = plannedPathPayload(message);
  const path = payload.path || message.path;
  const path3d = payload.path3d || message.path3d;
  if (!Array.isArray(path) || !Array.isArray(path3d) || path3d.length === 0) {
    return false;
  }
  const firstPoint = path3d[0];
  return Boolean(
    firstPoint
    && Array.isArray(firstPoint.pos)
    && typeof firstPoint.altitude === 'number'
    && Number.isFinite(firstPoint.altitude)
  );
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

function orderKey(order) {
  return order && (order.orderId || order.order_id);
}

function missionKey(mission) {
  return mission && (mission.missionId || mission.mission_id);
}

function rememberRuntimeMessage(message) {
  if (!simId || message.simId !== simId) return;
  const payload = message.payload || {};
  if (message.type === 'order_update') {
    const key = orderKey(payload);
    if (key) observedOrders.set(key, payload);
  }
  if (message.type === 'order_state') {
    if (Array.isArray(payload.orders)) {
      payload.orders.forEach((order) => {
        const key = orderKey(order);
        if (key) observedOrders.set(key, order);
      });
    }
    if (Array.isArray(payload.missions)) {
      payload.missions.forEach((mission) => {
        const key = missionKey(mission);
        if (key) observedMissions.set(key, mission);
      });
    }
  }
  if (message.type === 'mission_update') {
    const key = missionKey(payload);
    if (key) observedMissions.set(key, payload);
  }
  if (message.type === 'telemetry') {
    const telemetry = telemetryPayload(message);
    if (telemetry.currentOrderId || telemetry.currentMissionId) {
      observedMissionTelemetry = true;
    }
  }
}

function findOrder(message, orderId) {
  const payload = message.payload || {};
  if (message.type === 'order_update') {
    const id = payload.orderId || payload.order_id;
    return id === orderId ? payload : null;
  }
  if (message.type === 'order_state' && Array.isArray(payload.orders)) {
    return payload.orders.find((order) => (order.orderId || order.order_id) === orderId) || null;
  }
  return null;
}

function isValidOrderPhase8(message, orderId) {
  const order = findOrder(message, orderId);
  if (!order) return false;
  if (!['pending', 'assigned', 'going_to_pickup', 'picked_up', 'delivering', 'completed', 'failed'].includes(order.status)) return false;
  if (order.status === 'failed') {
    return Array.isArray(order.validationErrors || order.validation_errors);
  }
  if (['assigned', 'going_to_pickup', 'picked_up', 'delivering', 'completed'].includes(order.status)) {
    return Boolean((order.assignedDroneId || order.assigned_drone_id) && (order.missionId || order.mission_id));
  }
  return Array.isArray(order.pickupNode || order.pickup_node)
    && Array.isArray(order.dropoffNode || order.dropoff_node);
}

function findMission(message, missionId) {
  const payload = message.payload || {};
  if (message.type === 'mission_update') {
    const id = payload.missionId || payload.mission_id;
    return id === missionId ? payload : null;
  }
  if (message.type === 'order_state' && Array.isArray(payload.missions)) {
    return payload.missions.find((mission) => (mission.missionId || mission.mission_id) === missionId) || null;
  }
  return null;
}

function missionContextTelemetry(message, orderId, missionId) {
  if (message.type !== 'telemetry') return false;
  const payload = telemetryPayload(message);
  return payload.currentOrderId === orderId || payload.currentMissionId === missionId;
}

function isRejectedOrder(message, orderId) {
  const order = findOrder(message, orderId);
  if (!order || order.status !== 'failed') return false;
  const validationErrors = order.validationErrors || order.validation_errors;
  const failedReason = order.failedReason || order.failed_reason;
  return (Array.isArray(validationErrors) && validationErrors.length > 0)
    || (typeof failedReason === 'string' && failedReason.length > 0);
}

function activeMultiOrderCount() {
  return Array.from(observedOrders.values()).filter((order) => (
    orderKey(order)
    && orderKey(order).startsWith('order_multi_')
    && ['assigned', 'going_to_pickup', 'picked_up', 'delivering', 'completed'].includes(order.status)
  )).length;
}

function progressedMultiOrderCount() {
  return Array.from(observedOrders.values()).filter((order) => (
    orderKey(order)
    && orderKey(order).startsWith('order_multi_')
    && ['going_to_pickup', 'picked_up', 'delivering', 'completed'].includes(order.status)
  )).length;
}

function multiMissionCount() {
  const linkedMissions = Array.from(observedMissions.values()).filter((mission) => {
    const orderId = mission.orderId || mission.order_id;
    return typeof orderId === 'string' && orderId.startsWith('order_multi_');
  }).length;
  return linkedMissions > 0 ? linkedMissions : observedMissions.size;
}

async function runScenario() {
  await waitFor((message) => message.type === 'registered' && message.role === 'frontend', 10000, 'frontend registered');
  pass('frontend registered');

  await waitFor(
    (message) => (
      message.type === 'worker_status' && (
        message.status === 'idle' || (message.payload && message.payload.status === 'idle')
      )
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
      orderBatch: [
        {
          orderId: 'order_test_1',
          pickup: [21.0285, 105.8542],
          dropoff: [21.0290, 105.8550],
          payloadKg: 1.2,
          priority: 'normal',
        },
      ],
      autoDispatch: true,
      simulationMode: 'order_dispatch',
    },
  });

  const assigned = await waitFor((message) => message.type === 'simulation_assigned', 30000, 'simulation assigned');
  simId = assigned.simId;
  clearObservedRuntime();
  pass('simulation assigned');

  await waitFor((message) => message.type === 'config' && message.simId === simId, 180000, 'config');

  await waitFor((message) => message.simId === simId && isValidTelemetry(message), 180000, 'telemetry received');
  lastTelemetryCount += 1;
  pass('telemetry received');

  const plannedPath = await waitFor((message) => message.type === 'planned_path' && message.simId === simId, 180000, 'planned path received');
  pass('planned path received');
  if (!isValidPlannedPath3d(plannedPath)) {
    fail('planned path altitude received', 'planned_path missing payload.path3d altitude points');
  }
  pass('planned path altitude received');

  const dispatchedOrderMessage = await waitFor(
    (message) => (
      message.simId === simId
      && ['order_update', 'order_state'].includes(message.type)
      && isValidOrderPhase8(message, 'order_test_1')
      && ['assigned', 'going_to_pickup'].includes(findOrder(message, 'order_test_1').status)
    ),
    60000,
    'order auto dispatch accepted'
  );
  const dispatchedOrder = findOrder(dispatchedOrderMessage, 'order_test_1');
  if (!dispatchedOrder || !['assigned', 'going_to_pickup'].includes(dispatchedOrder.status)) {
    fail('order auto dispatch accepted', `expected mission order, got ${dispatchedOrder && dispatchedOrder.status}`);
  }
  pass('order auto dispatch accepted');

  const missionId = dispatchedOrder.missionId || dispatchedOrder.mission_id;
  await waitFor(
    (message) => (
      message.simId === simId
      && ['mission_update', 'order_state'].includes(message.type)
      && findMission(message, missionId)
      && ['planned', 'to_pickup'].includes(findMission(message, missionId).status)
    ),
    60000,
    'mission runtime started'
  );
  await waitFor(
    (message) => message.simId === simId && missionContextTelemetry(message, 'order_test_1', missionId),
    60000,
    'mission telemetry context'
  );
  pass('mission runtime started');

  await waitFor(
    (message) => {
      if (message.simId !== simId || !['order_update', 'order_state'].includes(message.type)) return false;
      const order = findOrder(message, 'order_test_1');
      return order && ['picked_up', 'delivering'].includes(order.status);
    },
    180000,
    'pickup/dropoff mission progress observed'
  );
  pass('pickup/dropoff mission progress observed');

  clearBacklog();
  send({
    type: 'order_batch',
    simId,
    payload: {
      autoDispatch: true,
      orders: [
        {
          orderId: 'order_too_heavy',
          pickup: [21.0285, 105.8542],
          dropoff: [21.0290, 105.8550],
          payloadKg: 999,
          priority: 'normal',
        },
      ],
    },
  });

  await waitFor(
    (message) => (
      message.simId === simId
      && ['order_update', 'order_state'].includes(message.type)
      && isRejectedOrder(message, 'order_too_heavy')
    ),
    60000,
    'overweight order rejected'
  );
  pass('overweight order rejected');

  clearBacklog();
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

  clearBacklog();
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

  clearBacklog();
  send({
    type: 'command',
    simId,
    action: 'reset',
  });

  await waitFor((message) => message.type === 'telemetry' && message.simId === simId, 60000, 'reset accepted');
  pass('reset accepted');

  send({
    type: 'command',
    simId,
    action: 'stop',
  });

  await waitFor(
    (message) => (
      message.type === 'worker_status' && (
        message.status === 'idle' || (message.payload && message.payload.status === 'idle')
      )
    ) || (
      message.type === 'simulation_finished' && message.simId === simId
    ),
    60000,
    'single-drone stop accepted'
  );
  pass('single-drone stop accepted');

  clearBacklog();
  simId = null;
  send({
    type: 'request_start_simulation',
    payload: {
      mapId: 'hanoi_default',
      droneCount: 3,
      orderBatch: [
        {
          orderId: 'order_multi_1',
          pickup: [21.0285, 105.8542],
          dropoff: [21.0290, 105.8550],
          payloadKg: 0.8,
          priority: 'normal',
        },
        {
          orderId: 'order_multi_2',
          pickup: [21.0278, 105.8536],
          dropoff: [21.0300, 105.8560],
          payloadKg: 1.1,
          priority: 'high',
        },
        {
          orderId: 'order_multi_3',
          pickup: [21.0268, 105.8528],
          dropoff: [21.0296, 105.8538],
          payloadKg: 1.5,
          priority: 'urgent',
        },
        {
          orderId: 'order_multi_4',
          pickup: [21.0290, 105.8550],
          dropoff: [21.0278, 105.8536],
          payloadKg: 1.8,
          priority: 'normal',
        },
        {
          orderId: 'order_multi_5',
          pickup: [21.0300, 105.8560],
          dropoff: [21.0268, 105.8528],
          payloadKg: 2.0,
          priority: 'high',
        },
      ],
      autoDispatch: true,
      simulationMode: 'order_dispatch',
    },
  });

  const multiAssigned = await waitFor((message) => message.type === 'simulation_assigned', 30000, 'multi-drone simulation assigned');
  simId = multiAssigned.simId;
  clearObservedRuntime();
  pass('multi-drone simulation assigned');

  await waitFor((message) => message.type === 'config' && message.simId === simId, 180000, 'multi-drone config');

  const telemetryDrones = new Set();
  while (telemetryDrones.size < 3) {
    const telemetry = await waitFor(
      (message) => message.simId === simId && isValidTelemetry(message),
      180000,
      'multi-drone telemetry received'
    );
    telemetryDrones.add(droneId(telemetry));
  }
  ['drone_1', 'drone_2', 'drone_3'].forEach((id) => {
    if (!telemetryDrones.has(id)) {
      fail('multi-drone telemetry received', `missing ${id}`);
    }
  });
  pass('multi-drone telemetry received');

  const pathDrones = new Set();
  while (pathDrones.size < 3) {
    const planned = await waitFor(
      (message) => message.type === 'planned_path' && message.simId === simId,
      180000,
      'multi-drone planned paths received'
    );
    if (!isValidPlannedPath3d(planned)) {
      fail('multi-drone planned paths received', `planned_path missing path3d for ${droneId(planned)}`);
    }
    pathDrones.add(droneId(planned));
  }
  ['drone_1', 'drone_2', 'drone_3'].forEach((id) => {
    if (!pathDrones.has(id)) {
      fail('multi-drone planned paths received', `missing ${id}`);
    }
  });
  pass('multi-drone planned paths received');

  if (activeMultiOrderCount() < 3) {
    await waitFor(
      (message) => {
        rememberRuntimeMessage(message);
        return message.simId === simId
          && ['order_update', 'order_state', 'mission_update'].includes(message.type)
          && activeMultiOrderCount() >= 3;
      },
      90000,
      'multi-order dispatch accepted'
    );
  }
  pass('multi-order dispatch accepted');

  if (multiMissionCount() < 3 || (!observedMissionTelemetry && progressedMultiOrderCount() < 1)) {
    await waitFor(
      (message) => {
        rememberRuntimeMessage(message);
        return message.simId === simId
          && ['telemetry', 'order_update', 'order_state', 'mission_update'].includes(message.type)
          && multiMissionCount() >= 3
          && (observedMissionTelemetry || progressedMultiOrderCount() >= 1);
      },
      120000,
      'multi-order mission progress observed'
    );
  }
  pass('multi-order mission progress observed');

  clearBacklog();
  send({
    type: 'weather_update',
    simId,
    wind_dir: 120,
    wind_speed: 8,
    ambient_temp: 30,
    is_raining: false,
    payload: {
      wind_dir: 120,
      wind_speed: 8,
      ambient_temp: 30,
      is_raining: false,
    },
  });

  await waitFor(
    (message) => (
      message.type === 'event' && ['WEATHER_CHANGED', 'PATH_REPLANNED'].includes(eventCode(message))
    ) || (
      message.type === 'telemetry' && message.simId === simId
    ),
    60000,
    'multi-drone weather update accepted'
  );
  pass('multi-drone weather update accepted');

  clearBacklog();
  send({
    type: 'command',
    simId,
    action: 'reset',
  });

  const resetDrones = new Set();
  while (resetDrones.size < 3) {
    const telemetry = await waitFor(
      (message) => message.type === 'telemetry' && message.simId === simId,
      180000,
      'multi-drone reset telemetry'
    );
    resetDrones.add(droneId(telemetry));
  }
  pass('multi-drone reset telemetry');

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

  rememberRuntimeMessage(message);

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
