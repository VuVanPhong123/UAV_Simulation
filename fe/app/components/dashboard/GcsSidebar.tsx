'use client';

import AltitudePanel from '../panels/AltitudePanel';
import ConnectionPanel from '../panels/ConnectionPanel';
import ControlPanel from '../panels/ControlPanel';
import EventLogPanel from '../panels/EventLogPanel';
import LayerTogglePanel from '../panels/LayerTogglePanel';
import ObstaclePanel from '../panels/ObstaclePanel';
import TelemetryPanel from '../panels/TelemetryPanel';
import WeatherPanel from '../panels/WeatherPanel';
import type {
    DroneTelemetry,
    EventLogEntry,
    LayerToggles,
    ObstacleConfig,
    ObstacleType,
    PlannedPath3DPoint,
    ServerStatus,
    SimulationStatus,
    WeatherState,
    WorkerStatus
} from '../types/simulation';

type GcsSidebarProps = {
    serverStatus: ServerStatus;
    workerStatus: WorkerStatus;
    simulationStatus: SimulationStatus;
    activeSimId: string | null;
    frontendId: string | null;
    latencyMs: number | null;
    droneState: DroneTelemetry | null;
    plannedPath3d: PlannedPath3DPoint[];
    eventLogs: EventLogEntry[];
    weather: WeatherState;
    obstacleConfig: ObstacleConfig;
    layers: LayerToggles;
    batteryHistory: number[];
    temperatureHistory: number[];
    altitudeHistory: number[];
    onStart: () => void;
    onPause: () => void;
    onResume: () => void;
    onStop: () => void;
    onReset: () => void;
    onWeatherChange: (key: keyof WeatherState, value: number | boolean) => void;
    onApplyWeather: () => void;
    onObstacleChange: (key: keyof ObstacleConfig, value: number | ObstacleType) => void;
    onLayerToggle: (key: keyof LayerToggles) => void;
};

export default function GcsSidebar(props: GcsSidebarProps) {
    return (
        <aside className="flex h-full w-[360px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-slate-200 bg-slate-50 p-3">
            <ConnectionPanel
                serverStatus={props.serverStatus}
                workerStatus={props.workerStatus}
                simulationStatus={props.simulationStatus}
                activeSimId={props.activeSimId}
                frontendId={props.frontendId}
                latencyMs={props.latencyMs}
            />
            <ControlPanel
                serverStatus={props.serverStatus}
                workerStatus={props.workerStatus}
                simulationStatus={props.simulationStatus}
                activeSimId={props.activeSimId}
                onStart={props.onStart}
                onPause={props.onPause}
                onResume={props.onResume}
                onStop={props.onStop}
                onReset={props.onReset}
            />
            <TelemetryPanel
                droneState={props.droneState}
                batteryHistory={props.batteryHistory}
                temperatureHistory={props.temperatureHistory}
                altitudeHistory={props.altitudeHistory}
            />
            <AltitudePanel
                droneState={props.droneState}
                plannedPath3d={props.plannedPath3d}
                altitudeHistory={props.altitudeHistory}
            />
            <WeatherPanel
                weather={props.weather}
                onChange={props.onWeatherChange}
                onApply={props.onApplyWeather}
                disabled={!props.activeSimId}
            />
            <ObstaclePanel obstacleConfig={props.obstacleConfig} onChange={props.onObstacleChange} />
            <LayerTogglePanel layers={props.layers} onToggle={props.onLayerToggle} />
            <EventLogPanel events={props.eventLogs} />
        </aside>
    );
}
