export function translateDroneStatus(status?: string) {
    const labels: Record<string, string> = {
        idle: 'Sẵn sàng',
        planning: 'Đang lập đường bay',
        flying: 'Đang bay',
        rerouting: 'Đang đổi đường',
        charging: 'Đang sạc',
        paused: 'Tạm dừng',
        success: 'Thành công',
        failed: 'Thất bại',
        emergency_landing: 'Hạ cánh khẩn cấp'
    };
    return status ? labels[status] ?? status : '--';
}

export function translateOrderStatus(status?: string) {
    const labels: Record<string, string> = {
        pending: 'Chờ xử lý',
        assigned: 'Đã gán UAV',
        going_to_pickup: 'Đang tới điểm lấy hàng',
        picked_up: 'Đã lấy hàng',
        delivering: 'Đang giao hàng',
        completed: 'Hoàn thành',
        failed: 'Thất bại',
        canceled: 'Đã hủy'
    };
    return status ? labels[status] ?? status : '--';
}

export function translateMissionStatus(status?: string) {
    const labels: Record<string, string> = {
        planned: 'Đã lập kế hoạch',
        to_pickup: 'Tới điểm lấy hàng',
        pickup_arrived: 'Đã tới điểm lấy hàng',
        to_dropoff: 'Tới điểm giao hàng',
        completed: 'Hoàn thành',
        failed: 'Thất bại'
    };
    return status ? labels[status] ?? status : '--';
}

export function translateSimulationStatus(status?: string) {
    const labels: Record<string, string> = {
        idle: 'Sẵn sàng',
        running: 'Đang chạy',
        paused: 'Tạm dừng',
        stopped: 'Đã dừng',
        failed: 'Lỗi'
    };
    return status ? labels[status] ?? status : '--';
}

export function translateServerStatus(status?: string) {
    const labels: Record<string, string> = {
        connecting: 'Đang kết nối',
        connected: 'Đã kết nối',
        disconnected: 'Mất kết nối'
    };
    return status ? labels[status] ?? status : '--';
}

export function translateWorkerStatus(status?: string) {
    const labels: Record<string, string> = {
        idle: 'Sẵn sàng',
        busy: 'Đang bận',
        disconnected: 'Mất kết nối',
        error: 'Lỗi',
        unknown: 'Không rõ'
    };
    return status ? labels[status] ?? status : '--';
}

export function translatePriority(priority?: string) {
    const labels: Record<string, string> = {
        low: 'Thấp',
        normal: 'Bình thường',
        high: 'Cao',
        urgent: 'Khẩn cấp'
    };
    return priority ? labels[priority] ?? priority : '--';
}

export function translateTargetType(targetType?: string | null) {
    const labels: Record<string, string> = {
        pickup: 'Điểm lấy hàng',
        dropoff: 'Điểm giao hàng',
        charging_station: 'Trạm sạc',
        goal: 'Đích cũ',
        idle: 'Chờ nhiệm vụ',
        depot: 'Kho UAV'
    };
    return targetType ? labels[targetType] ?? targetType : '--';
}

export function translateSimulationMode(mode?: string | null) {
    const labels: Record<string, string> = {
        order_dispatch: 'Điều phối theo đơn hàng',
        idle_on_start: 'Chờ đơn hàng'
    };
    return mode ? labels[mode] ?? mode : '--';
}

export function translateEventFilter(filter: string) {
    const labels: Record<string, string> = {
        all: 'Tất cả',
        selected_drone: 'UAV đang chọn',
        selected_order: 'Đơn đang chọn',
        selected_mission: 'Nhiệm vụ đang chọn'
    };
    return labels[filter] ?? filter;
}

export function formatDistanceMeters(value?: number | null) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
    if (value >= 1000) return `${(value / 1000).toFixed(2)} km`;
    return `${Math.round(value)} m`;
}

export function formatEtaSeconds(value?: number | null) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '--';
    const totalSeconds = Math.round(value);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes <= 0) return `${seconds} giây`;
    return `${minutes} phút ${seconds.toString().padStart(2, '0')} giây`;
}

export function formatPayloadKg(value?: number | null) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
    return `${value.toFixed(value % 1 === 0 ? 0 : 1)} kg`;
}

export function formatLatLng(latlng?: [number, number] | null) {
    if (!latlng) return '--';
    return `${latlng[0].toFixed(6)}, ${latlng[1].toFixed(6)}`;
}

export function formatTimestamp(ts?: number | null) {
    if (!ts) return '--';
    return new Date(ts).toLocaleString('vi-VN');
}

export function orderIdOf(order: { orderId?: string; order_id?: string }) {
    return order.orderId ?? order.order_id ?? '-';
}

export function missionIdOf(mission: { missionId?: string; mission_id?: string }) {
    return mission.missionId ?? mission.mission_id ?? '-';
}
