
# Cách chạy dự án UAV
# Xem cách sử dụng hệ thống chi tiết ở [HOW_TO_USE.md](HOW_TO_USE.md)
## 1. Chạy thủ công

Cần mở 3 terminal.

### Terminal 1: Chạy WebSocket Broker

```powershell
cd C:\Users\ADMIN\UAV\server
npm install
node index.js
````

Nếu chạy đúng sẽ thấy:

```text
WebSocket Broker running at ws://localhost:8080
```

---

### Terminal 2: Chạy Python Worker

```powershell
cd C:\Users\ADMIN\UAV\coreUAV

python -m venv .venv
.\.venv\Scripts\activate

pip install --upgrade pip
pip install -r requirements.txt

$env:BROKER_WS_URL="ws://localhost:8080"
$env:WORKER_NAME="local-worker-1"
$env:WORKER_MAX_DRONES="15"
$env:WORKER_SUPPORTS_SHARDING="true"

python worker.py
```

Nếu muốn chạy nhiều UAV hơn, mở thêm terminal worker thứ hai:

```powershell
cd C:\Users\ADMIN\UAV\coreUAV
.\.venv\Scripts\activate

$env:BROKER_WS_URL="ws://localhost:8080"
$env:WORKER_NAME="local-worker-2"
$env:WORKER_MAX_DRONES="15"
$env:WORKER_SUPPORTS_SHARDING="true"

python worker.py
```

---

### Terminal 3: Chạy Frontend

```powershell
cd C:\Users\ADMIN\UAV\fe
npm install
npm run dev
```

Mở trình duyệt:

```text
http://localhost:3000
```

---

## 2. Chạy bằng Docker

Tại thư mục root project:

```powershell
cd C:\Users\ADMIN\UAV
docker compose up --build
```

Mở trình duyệt:

```text
http://localhost:3000
```

---

## 3. Chạy Docker ở chế độ nền

```powershell
docker compose up --build -d
```

Xem log:

```powershell
docker compose logs -f
```

Xem log riêng từng service:

```powershell
docker compose logs -f broker
docker compose logs -f worker-1
docker compose logs -f worker-2
docker compose logs -f fe
```

---

## 4. Dừng Docker

```powershell
docker compose down
```

---

## 5. Build lại Docker từ đầu

```powershell
docker compose down
docker compose build --no-cache
docker compose up
```

---

## 6. Lưu ý quan trọng

* Broker phải chạy trước worker.
* Khi chạy thủ công, worker dùng:

```text
ws://localhost:8080
```

* Khi chạy Docker, worker phải dùng:

```text
ws://broker:8080
```


* Nếu worker báo `ConnectionRefusedError`, thường là broker chưa chạy hoặc broker bị crash.
* Nếu muốn demo 30 UAV, nên chạy 2 worker, mỗi worker `WORKER_MAX_DRONES=15`.
