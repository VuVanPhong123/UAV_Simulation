const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('UAV Simulation Broker is running');
});

const wss = new WebSocket.Server({ server });

const clients = new Map();
const workers = new Map();
const frontends = new Map();
const simulations = new Map();

let frontendSeq = 1;
let workerSeq = 1;
let simSeq = 1;

function nowMs() {
    return Date.now();
}

function safeSend(ws, payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
        ws.send(JSON.stringify(payload));
        return true;
    } catch (err) {
        console.error('[Broker] send failed:', err.message);
        return false;
    }
}

function getClientMeta(ws) {
    return clients.get(ws);
}

function getWorkerStatus() {
    const statuses = [...clients.values()]
        .filter(meta => meta.role === 'worker')
        .map(meta => meta.status);
    if (statuses.includes('idle')) return 'idle';
    if (statuses.includes('busy')) return 'busy';
    return 'disconnected';
}

function workerCapacity(workerWs) {
    const meta = getClientMeta(workerWs) || {};
    const value = Number(meta.maxDrones);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 15;
}

function publicWorkerInfo(workerId, workerWs) {
    const meta = workerWs ? getClientMeta(workerWs) : null;
    return {
        workerId,
        workerName: meta?.workerName ?? workerId,
        status: meta?.status ?? 'unknown',
        simId: meta?.simId ?? null,
        shardId: meta?.shardId ?? null,
        maxDrones: Number.isFinite(Number(meta?.maxDrones)) ? Number(meta.maxDrones) : null,
        supportsSharding: meta?.supportsSharding !== false,
        currentMapId: meta?.currentMapId ?? null
    };
}

function broadcastWorkerList() {
    broadcastToFrontends({
        type: 'worker_list',
        timestamp: nowMs(),
        payload: {
            workers: [...workers.entries()].map(([workerId, workerWs]) => publicWorkerInfo(workerId, workerWs))
        }
    });
}

function broadcastToFrontends(payload) {
    for (const frontendWs of frontends.values()) {
        safeSend(frontendWs, payload);
    }
}

function getIdleWorkers() {
    return [...workers.entries()]
        .map(([workerId, workerWs]) => ({ workerId, workerWs, meta: getClientMeta(workerWs) }))
        .filter(item => item.meta?.status === 'idle');
}

function splitOrdersForShard(orderBatch, shardIndex, shardCount) {
    const rows = Array.isArray(orderBatch)
        ? orderBatch
        : Array.isArray(orderBatch?.orders)
            ? orderBatch.orders
            : [];
    return rows.filter((_, idx) => idx % shardCount === shardIndex);
}

function shardPublicInfo(shard) {
    return {
        shardId: shard.shardId,
        shardIndex: shard.shardIndex,
        shardCount: shard.shardCount,
        workerId: shard.workerId,
        droneCount: shard.droneCount,
        droneIdOffset: shard.droneIdOffset,
        startDroneId: shard.startDroneId,
        endDroneId: shard.endDroneId
    };
}

function buildShardAssignments(simId, requestedDroneCount, orderBatch) {
    const idle = getIdleWorkers().filter(item => item.meta?.supportsSharding !== false);
    let remaining = requestedDroneCount;
    let offset = 0;
    const shards = [];

    for (const item of idle) {
        if (remaining <= 0) break;
        const cap = workerCapacity(item.workerWs);
        const count = Math.min(cap, remaining);
        if (count <= 0) continue;

        shards.push({
            shardId: `${simId}_shard_${shards.length}`,
            shardIndex: shards.length,
            workerId: item.workerId,
            workerWs: item.workerWs,
            droneCount: count,
            droneIdOffset: offset,
            startDroneId: `drone_${offset + 1}`,
            endDroneId: `drone_${offset + count}`,
            orderBatch: []
        });

        offset += count;
        remaining -= count;
    }

    if (remaining > 0) return null;

    const shardCount = shards.length;
    shards.forEach((shard, idx) => {
        shard.shardCount = shardCount;
        shard.orderBatch = splitOrdersForShard(orderBatch, idx, shardCount);
    });
    return shards;
}

function sendBrokerEventToFrontend(frontendWs, level, code, message, simId = null) {
    safeSend(frontendWs, {
        type: 'event',
        simId,
        timestamp: nowMs(),
        payload: {
            level,
            code,
            message
        }
    });
}

function markWorkerStatus(workerId, status) {
    const workerWs = workers.get(workerId);
    if (!workerWs) {
        broadcastToFrontends({
            type: 'worker_status',
            workerId,
            status: 'disconnected',
            timestamp: nowMs()
        });
        broadcastWorkerList();
        return;
    }

    const meta = getClientMeta(workerWs);
    if (meta) {
        meta.status = status;
    }

    broadcastToFrontends({
        type: 'worker_status',
        workerId,
        workerName: meta?.workerName ?? workerId,
        status,
        simId: meta?.simId ?? null,
        shardId: meta?.shardId ?? null,
        maxDrones: Number.isFinite(Number(meta?.maxDrones)) ? Number(meta.maxDrones) : null,
        supportsSharding: meta?.supportsSharding !== false,
        timestamp: nowMs()
    });
    broadcastWorkerList();
}

function sendConnectionState(frontendWs) {
    const meta = getClientMeta(frontendWs);
    const activeSim = [...simulations.values()].find(sim => sim.frontendId === meta?.id && sim.status === 'running');

    safeSend(frontendWs, {
        type: 'connection_state',
        server: 'connected',
        workerStatus: getWorkerStatus(),
        activeSimId: activeSim?.simId ?? null,
        timestamp: nowMs()
    });
    safeSend(frontendWs, {
        type: 'worker_list',
        timestamp: nowMs(),
        payload: {
            workers: [...workers.entries()].map(([workerId, workerWs]) => publicWorkerInfo(workerId, workerWs))
        }
    });
}

function registerClient(ws, data) {
    const meta = getClientMeta(ws);

    if (data.role === 'frontend') {
        const frontendId = `frontend_${frontendSeq++}`;
        Object.assign(meta, {
            id: frontendId,
            role: 'frontend',
            status: 'idle',
            simId: null
        });
        frontends.set(frontendId, ws);

        safeSend(ws, {
            type: 'registered',
            role: 'frontend',
            clientId: frontendId,
            timestamp: nowMs()
        });
        sendConnectionState(ws);
        console.log(`[Broker] frontend registered: ${frontendId}`);
        return;
    }

    if (data.role === 'worker') {
        const workerId = `worker_${workerSeq++}`;
        const metadata = data.metadata || {};
        const rawMaxDrones = Number(metadata.maxDrones ?? data.maxDrones);
        Object.assign(meta, {
            id: workerId,
            role: 'worker',
            status: 'idle',
            simId: null,
            shardId: null,
            workerName: metadata.workerName ?? data.workerName ?? workerId,
            maxDrones: Number.isFinite(rawMaxDrones) && rawMaxDrones > 0 ? Math.floor(rawMaxDrones) : 15,
            supportsSharding: metadata.supportsSharding !== false,
            supportsCustomMap: Boolean(metadata.supportsCustomMap),
            capabilities: Array.isArray(metadata.capabilities) ? metadata.capabilities : [],
            currentMapId: metadata.currentMapId ?? null,
            connectedAt: nowMs(),
            pid: metadata.pid ?? null
        });
        workers.set(workerId, ws);

        safeSend(ws, {
            type: 'registered',
            role: 'worker',
            clientId: workerId,
            status: 'idle',
            workerName: meta.workerName,
            timestamp: nowMs()
        });
        markWorkerStatus(workerId, 'idle');
        console.log(`[Broker] worker registered: ${workerId}`);
        return;
    }

    sendBrokerEventToFrontend(ws, 'error', 'BROKER_ERROR', 'Invalid register role.');
}

function requestStartSimulation(ws, data) {
    const frontendMeta = getClientMeta(ws);
    if (frontendMeta?.role !== 'frontend') {
        sendBrokerEventToFrontend(ws, 'error', 'BROKER_ERROR', 'Only frontend clients can start simulations.');
        return;
    }

    const existingSim = [...simulations.values()].find(
        sim => sim.frontendId === frontendMeta.id && sim.status === 'running'
    );
    if (existingSim) {
        sendBrokerEventToFrontend(ws, 'warning', 'BROKER_ERROR', 'Simulation is already running.', existingSim.simId);
        return;
    }

    const payload = data.payload ?? {};
    const requestedDroneCountRaw = Number(payload.droneCount ?? payload.drone_count ?? 1);
    const requestedDroneCount = Number.isFinite(requestedDroneCountRaw)
        ? Math.max(1, Math.min(100000, Math.floor(requestedDroneCountRaw)))
        : 1;
    const startupOrders = payload.orderBatch ?? payload.order_batch ?? payload.orders;
    const simId = `sim_${simSeq++}`;
    const shards = buildShardAssignments(simId, requestedDroneCount, startupOrders);
    if (!shards) {
        safeSend(ws, {
            type: 'worker_busy',
            message: `Khong du worker ranh de chay ${requestedDroneCount} UAV. Hay bat them worker local.`,
            timestamp: nowMs()
        });
        return;
    }

    const simulation = {
        simId,
        frontendId: frontendMeta.id,
        workerId: shards[0]?.workerId ?? null,
        workerIds: shards.map(shard => shard.workerId),
        shards: shards.map(shardPublicInfo),
        status: 'running',
        createdAt: nowMs(),
        finishedNotified: false,
        configForwarded: false,
        shardFinished: {},
        shardStatuses: {}
    };
    simulations.set(simId, simulation);

    frontendMeta.simId = simId;
    frontendMeta.status = 'busy';

    for (const shard of shards) {
        const workerMeta = getClientMeta(shard.workerWs);
        if (workerMeta) {
            workerMeta.simId = simId;
            workerMeta.shardId = shard.shardId;
            workerMeta.status = 'busy';
        }
    }

    safeSend(ws, {
        type: 'simulation_assigned',
        simId,
        workerId: shards[0]?.workerId ?? null,
        workerIds: shards.map(shard => shard.workerId),
        shards: shards.map(shardPublicInfo),
        totalDrones: requestedDroneCount,
        sharded: shards.length > 1,
        status: 'running',
        timestamp: nowMs()
    });

    for (const shard of shards) {
        safeSend(shard.workerWs, {
            type: 'start_simulation',
            simId,
            frontendId: frontendMeta.id,
            payload: {
                ...payload,
                mapId: payload.mapId || 'hanoi_my_dinh_me_tri_large',
                droneCount: shard.droneCount,
                globalDroneCount: requestedDroneCount,
                orderBatch: shard.orderBatch,
                autoDispatch: payload.autoDispatch ?? true,
                simulationMode: payload.simulationMode || 'order_dispatch',
                shardMode: true,
                shardId: shard.shardId,
                shardIndex: shard.shardIndex,
                shardCount: shard.shardCount,
                droneIdOffset: shard.droneIdOffset,
                workerDroneCapacity: workerCapacity(shard.workerWs),
                altitudeBandIndex: shard.shardIndex
            }
        });
        markWorkerStatus(shard.workerId, 'busy');
    }
    console.log(`[Broker] assigned ${simId}: ${frontendMeta.id} -> ${shards.map(shard => shard.workerId).join(', ')}`);
}

function routeFrontendMessage(ws, data) {
    const frontendMeta = getClientMeta(ws);
    const simId = data.simId;
    const simulation = simId ? simulations.get(simId) : null;

    if (!simulation || simulation.frontendId !== frontendMeta?.id) {
        sendBrokerEventToFrontend(ws, 'error', 'BROKER_ERROR', 'Invalid or missing simId.');
        return;
    }

    const workerIds = simulation.workerIds || [simulation.workerId].filter(Boolean);
    const shardCount = simulation.shards?.length || workerIds.length || 1;

    if (data.type === 'order_batch') {
        for (const shard of simulation.shards || []) {
            const workerWs = workers.get(shard.workerId);
            if (!workerWs || workerWs.readyState !== WebSocket.OPEN) {
                sendBrokerEventToFrontend(ws, 'error', 'WORKER_DISCONNECTED', 'Worker disconnected.', simId);
                finishSimulation(simulation, 'failed');
                return;
            }
            safeSend(workerWs, {
                ...data,
                payload: {
                    ...(data.payload || {}),
                    orders: splitOrdersForShard(data.payload?.orders ?? data.payload?.orderBatch ?? data.payload, shard.shardIndex, shardCount),
                    autoDispatch: data.payload?.autoDispatch ?? true
                }
            });
        }
        return;
    }

    for (const workerId of workerIds) {
        const workerWs = workers.get(workerId);
        if (!workerWs || workerWs.readyState !== WebSocket.OPEN) {
            sendBrokerEventToFrontend(ws, 'error', 'WORKER_DISCONNECTED', 'Worker disconnected.', simId);
            finishSimulation(simulation, 'failed');
            return;
        }
        safeSend(workerWs, data);
    }
}

function finishSimulation(simulation, status, notifyFrontend = true) {
    simulation.status = ['success', 'stopped'].includes(status) ? 'stopped' : 'failed';

    const workerIds = simulation.workerIds || [simulation.workerId].filter(Boolean);
    for (const workerId of workerIds) {
        const workerWs = workers.get(workerId);
        const workerMeta = workerWs ? getClientMeta(workerWs) : null;
        if (workerMeta) {
            workerMeta.status = 'idle';
            workerMeta.simId = null;
            workerMeta.shardId = null;
        }
        markWorkerStatus(workerId, workerWs ? 'idle' : 'disconnected');
    }

    const frontendWs = frontends.get(simulation.frontendId);
    const frontendMeta = frontendWs ? getClientMeta(frontendWs) : null;
    if (frontendMeta) {
        frontendMeta.status = 'idle';
        frontendMeta.simId = null;
    }

    if (notifyFrontend && frontendWs && !simulation.finishedNotified) {
        simulation.finishedNotified = true;
        safeSend(frontendWs, {
            type: 'simulation_finished',
            simId: simulation.simId,
            timestamp: nowMs(),
            payload: {
                status
            }
        });
    }
}

function routeWorkerMessage(ws, data) {
    const workerMeta = getClientMeta(ws);
    const simId = data.simId ?? workerMeta?.simId;
    const simulation = simId ? simulations.get(simId) : null;

    const workerIds = simulation?.workerIds || [simulation?.workerId].filter(Boolean);
    if (!simulation || !workerIds.includes(workerMeta?.id)) {
        console.warn('[Broker] dropped worker message with invalid simId:', data.type, simId);
        return;
    }

    const frontendWs = frontends.get(simulation.frontendId);
    if (!frontendWs || frontendWs.readyState !== WebSocket.OPEN) {
        console.warn('[Broker] frontend missing for worker message:', simulation.frontendId);
        return;
    }

    data.workerId = workerMeta.id;
    data.workerName = workerMeta.workerName;
    data.shardId = data.shardId || workerMeta.shardId || null;

    if (data.type === 'config') {
        if (simulation.configForwarded) return;
        simulation.configForwarded = true;
        const totalDrones = (simulation.shards || []).reduce((sum, shard) => sum + Number(shard.droneCount || 0), 0);
        data.payload = {
            ...(data.payload || {}),
            droneCount: totalDrones || data.payload?.droneCount,
            globalDroneCount: totalDrones || data.payload?.globalDroneCount,
            sharded: (simulation.shards?.length || 0) > 1,
            shards: simulation.shards || []
        };
        data.droneCount = data.payload.droneCount;
        data.globalDroneCount = data.payload.globalDroneCount;
        data.sharded = (simulation.shards?.length || 0) > 1;
        data.shards = simulation.shards || [];
    }

    if (data.type === 'worker_status') {
        const status = data.status ?? data.payload?.status;
        if (status) markWorkerStatus(workerMeta.id, status);
        safeSend(frontendWs, data);
        return;
    }

    if (data.type === 'simulation_finished') {
        const status = data.payload?.status ?? 'stopped';
        simulation.shardFinished[workerMeta.id] = true;
        simulation.shardStatuses[workerMeta.id] = status;
        if (status === 'failed' || status === 'truncated') {
            finishSimulation(simulation, 'failed');
            return;
        }
        const allDone = workerIds.every(workerId => simulation.shardFinished[workerId]);
        if (allDone) {
            finishSimulation(simulation, status);
        }
        return;
    }

    safeSend(frontendWs, data);

    if (data.type === 'event') {
        return;
    }
}

function handlePong(ws, data) {
    const meta = getClientMeta(ws);
    if (!meta) return;

    const sentAt = Number(data.timestamp);
    if (!Number.isFinite(sentAt)) return;

    meta.latencyMs = nowMs() - sentAt;
    safeSend(ws, {
        type: 'latency_update',
        latencyMs: meta.latencyMs,
        timestamp: nowMs()
    });
}

function handleMessage(ws, rawMessage) {
    let data;
    try {
        data = JSON.parse(rawMessage.toString());
    } catch (err) {
        sendBrokerEventToFrontend(ws, 'error', 'BROKER_ERROR', 'Invalid JSON message.');
        return;
    }

    if (!data || typeof data.type !== 'string') {
        sendBrokerEventToFrontend(ws, 'error', 'BROKER_ERROR', 'Invalid message type.');
        return;
    }

    if (data.type === 'pong') {
        handlePong(ws, data);
        return;
    }

    if (data.type === 'register') {
        registerClient(ws, data);
        return;
    }

    const meta = getClientMeta(ws);
    if (data.type === 'request_start_simulation') {
        requestStartSimulation(ws, data);
        return;
    }

    if (['command', 'weather_update', 'add_obstacle', 'add_no_fly_zone', 'order_batch', 'dispatch_orders', 'request_wind_shadow'].includes(data.type)) {
        routeFrontendMessage(ws, data);
        return;
    }

    if ([
        'config',
        'telemetry',
        'event',
        'planned_path',
        'wind_shadow_zones',
        'order_state',
        'order_update',
        'mission_update',
        'simulation_finished',
        'worker_status'
    ].includes(data.type)) {
        if (meta?.role === 'worker') {
            routeWorkerMessage(ws, data);
        } else {
            sendBrokerEventToFrontend(ws, 'error', 'BROKER_ERROR', 'This message type must be sent by a worker.');
        }
        return;
    }

    sendBrokerEventToFrontend(ws, 'error', 'BROKER_ERROR', `Unknown message type: ${data.type}`);
}

function handleClose(ws) {
    const meta = getClientMeta(ws);
    if (!meta) return;

    if (meta.role === 'worker') {
        const workerId = meta.id;
        const activeSim = meta.simId
            ? simulations.get(meta.simId)
            : [...simulations.values()].find(sim => (sim.workerIds || [sim.workerId]).includes(workerId) && sim.status === 'running');
        if (activeSim) {
            const frontendWs = frontends.get(activeSim.frontendId);
            if (frontendWs) {
                sendBrokerEventToFrontend(frontendWs, 'error', 'WORKER_DISCONNECTED', 'Worker disconnected.', activeSim.simId);
            }
            finishSimulation(activeSim, 'failed');
        }
        workers.delete(workerId);
        broadcastToFrontends({
            type: 'worker_status',
            workerId,
            status: 'disconnected',
            timestamp: nowMs()
        });
        broadcastWorkerList();
        console.log(`[Broker] worker disconnected: ${workerId}`);
    } else if (meta.role === 'frontend') {
        const frontendId = meta.id;
        const activeSim = meta.simId ? simulations.get(meta.simId) : null;
        if (activeSim) {
            activeSim.status = 'stopped';
            for (const workerId of activeSim.workerIds || [activeSim.workerId].filter(Boolean)) {
                const workerWs = workers.get(workerId);
                if (!workerWs) continue;
                safeSend(workerWs, {
                    type: 'command',
                    simId: activeSim.simId,
                    action: 'stop'
                });
                const workerMeta = getClientMeta(workerWs);
                if (workerMeta) {
                    workerMeta.status = 'idle';
                    workerMeta.simId = null;
                    workerMeta.shardId = null;
                }
                markWorkerStatus(workerId, 'idle');
            }
        }
        frontends.delete(frontendId);
        console.log(`[Broker] frontend disconnected: ${frontendId}`);
    }

    meta.status = 'disconnected';
    clients.delete(ws);
}

wss.on('connection', (ws) => {
    clients.set(ws, {
        id: `unknown_${nowMs()}`,
        role: 'unknown',
        status: undefined,
        simId: null,
        latencyMs: null,
        connectedAt: nowMs()
    });

    console.log('[Broker] client connected');

    ws.on('message', (message) => handleMessage(ws, message));
    ws.on('close', () => handleClose(ws));
    ws.on('error', (err) => {
        const meta = getClientMeta(ws);
        if (meta) meta.status = 'error';
        console.error('[Broker] websocket error:', err.message);
    });
});

setInterval(() => {
    for (const frontendWs of frontends.values()) {
        safeSend(frontendWs, {
            type: 'ping',
            timestamp: nowMs()
        });
    }
}, 5000);

const PORT = 8080;
server.listen(PORT, () => {
    console.log(`WebSocket Broker running at ws://localhost:${PORT}`);
});
