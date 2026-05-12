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

function broadcastToFrontends(payload) {
    for (const frontendWs of frontends.values()) {
        safeSend(frontendWs, payload);
    }
}

function findIdleWorker() {
    for (const [workerId, workerWs] of workers.entries()) {
        const meta = getClientMeta(workerWs);
        if (meta?.status === 'idle') {
            return { workerId, workerWs };
        }
    }
    return null;
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
        return;
    }

    const meta = getClientMeta(workerWs);
    if (meta) {
        meta.status = status;
    }

    broadcastToFrontends({
        type: 'worker_status',
        workerId,
        status,
        timestamp: nowMs()
    });
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
        Object.assign(meta, {
            id: workerId,
            role: 'worker',
            status: 'idle',
            simId: null
        });
        workers.set(workerId, ws);

        safeSend(ws, {
            type: 'registered',
            role: 'worker',
            clientId: workerId,
            status: 'idle',
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

    const idleWorker = findIdleWorker();
    if (!idleWorker) {
        safeSend(ws, {
            type: 'worker_busy',
            message: 'Không có worker rảnh để chạy simulation.',
            timestamp: nowMs()
        });
        return;
    }

    const simId = `sim_${simSeq++}`;
    const simulation = {
        simId,
        frontendId: frontendMeta.id,
        workerId: idleWorker.workerId,
        status: 'running',
        createdAt: nowMs(),
        finishedNotified: false
    };
    simulations.set(simId, simulation);

    frontendMeta.simId = simId;
    frontendMeta.status = 'busy';

    const workerMeta = getClientMeta(idleWorker.workerWs);
    if (workerMeta) {
        workerMeta.simId = simId;
        workerMeta.status = 'busy';
    }

    safeSend(ws, {
        type: 'simulation_assigned',
        simId,
        workerId: idleWorker.workerId,
        status: 'running',
        timestamp: nowMs()
    });

    safeSend(idleWorker.workerWs, {
        type: 'start_simulation',
        simId,
        frontendId: frontendMeta.id,
        payload: data.payload ?? {
            mapId: 'hanoi_my_dinh_me_tri',
            droneCount: 1
        }
    });

    markWorkerStatus(idleWorker.workerId, 'busy');
    console.log(`[Broker] assigned ${simId}: ${frontendMeta.id} -> ${idleWorker.workerId}`);
}

function routeFrontendMessage(ws, data) {
    const frontendMeta = getClientMeta(ws);
    const simId = data.simId;
    const simulation = simId ? simulations.get(simId) : null;

    if (!simulation || simulation.frontendId !== frontendMeta?.id) {
        sendBrokerEventToFrontend(ws, 'error', 'BROKER_ERROR', 'Invalid or missing simId.');
        return;
    }

    const workerWs = workers.get(simulation.workerId);
    if (!workerWs || workerWs.readyState !== WebSocket.OPEN) {
        sendBrokerEventToFrontend(ws, 'error', 'WORKER_DISCONNECTED', 'Worker disconnected.', simId);
        simulation.status = 'failed';
        return;
    }

    safeSend(workerWs, data);
}

function finishSimulation(simulation, status, notifyFrontend = true) {
    simulation.status = ['success', 'stopped'].includes(status) ? 'stopped' : 'failed';

    const workerWs = workers.get(simulation.workerId);
    const workerMeta = workerWs ? getClientMeta(workerWs) : null;
    if (workerMeta) {
        workerMeta.status = 'idle';
        workerMeta.simId = null;
    }

    const frontendWs = frontends.get(simulation.frontendId);
    const frontendMeta = frontendWs ? getClientMeta(frontendWs) : null;
    if (frontendMeta) {
        frontendMeta.status = 'idle';
        frontendMeta.simId = null;
    }

    markWorkerStatus(simulation.workerId, workerWs ? 'idle' : 'disconnected');

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

    if (!simulation || simulation.workerId !== workerMeta?.id) {
        console.warn('[Broker] dropped worker message with invalid simId:', data.type, simId);
        return;
    }

    const frontendWs = frontends.get(simulation.frontendId);
    if (!frontendWs || frontendWs.readyState !== WebSocket.OPEN) {
        console.warn('[Broker] frontend missing for worker message:', simulation.frontendId);
        return;
    }

    safeSend(frontendWs, data);

    if (data.type === 'worker_status') {
        const status = data.status ?? data.payload?.status;
        if (status) markWorkerStatus(workerMeta.id, status);
        return;
    }

    if (data.type === 'simulation_finished') {
        const status = data.payload?.status ?? 'stopped';
        simulation.finishedNotified = true;
        finishSimulation(simulation, status, false);
        return;
    }

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
        const activeSim = meta.simId ? simulations.get(meta.simId) : null;
        if (activeSim) {
            activeSim.status = 'failed';
            const frontendWs = frontends.get(activeSim.frontendId);
            const frontendMeta = frontendWs ? getClientMeta(frontendWs) : null;
            if (frontendMeta) {
                frontendMeta.status = 'idle';
                frontendMeta.simId = null;
            }
            if (frontendWs) {
                sendBrokerEventToFrontend(frontendWs, 'error', 'WORKER_DISCONNECTED', 'Worker disconnected.', activeSim.simId);
                safeSend(frontendWs, {
                    type: 'simulation_finished',
                    simId: activeSim.simId,
                    timestamp: nowMs(),
                    payload: {
                        status: 'failed'
                    }
                });
            }
        }
        workers.delete(workerId);
        broadcastToFrontends({
            type: 'worker_status',
            workerId,
            status: 'disconnected',
            timestamp: nowMs()
        });
        console.log(`[Broker] worker disconnected: ${workerId}`);
    } else if (meta.role === 'frontend') {
        const frontendId = meta.id;
        const activeSim = meta.simId ? simulations.get(meta.simId) : null;
        if (activeSim) {
            activeSim.status = 'stopped';
            const workerWs = workers.get(activeSim.workerId);
            if (workerWs) {
                safeSend(workerWs, {
                    type: 'command',
                    simId: activeSim.simId,
                    action: 'stop'
                });
                const workerMeta = getClientMeta(workerWs);
                if (workerMeta) {
                    workerMeta.status = 'idle';
                    workerMeta.simId = null;
                }
                markWorkerStatus(activeSim.workerId, 'idle');
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
