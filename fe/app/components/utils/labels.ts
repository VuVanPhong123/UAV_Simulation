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
        idle: 'Chờ',
        running: 'Đang chạy',
        paused: 'Tạm dừng',
        stopped: 'Đã dừng',
        failed: 'Thất bại'
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
