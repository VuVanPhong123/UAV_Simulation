
# Hướng dẫn sử dụng hệ thống UAV Delivery Simulation

## 1. Mở hệ thống

Sau khi chạy backend, worker và frontend, mở trình duyệt tại:

```text
http://localhost:3000
````

Giao diện chính là dashboard điều khiển UAV theo thời gian thực.

Màn hình gồm 4 khu vực chính:

1. **Thanh trạng thái trên cùng**: hiển thị trạng thái server, worker, mô phỏng, số UAV, độ trễ kết nối.
2. **Thanh điều hướng bên trái**: chuyển giữa các nhóm chức năng.
3. **Bản đồ trung tâm**: hiển thị UAV, tuyến bay, đơn hàng, vùng cấm bay, vật cản, tòa nhà.
4. **Panel bên phải và panel dưới**: hiển thị điều khiển, thông tin UAV, đơn hàng, môi trường và sự kiện.

![alt text](doc\doc\image.png)

---

## 2. Kiểm tra trạng thái trước khi chạy mô phỏng

Trước khi bắt đầu, nhìn thanh trạng thái trên cùng.

Cần đảm bảo:

```text
Server: connected
Worker: idle
Simulation: idle hoặc stopped
```

Nếu `Server` chưa kết nối, kiểm tra broker WebSocket.

Nếu `Worker` chưa kết nối, kiểm tra Python worker.

Nếu worker đang `busy`, cần dừng mô phỏng hiện tại hoặc chờ worker rảnh.

---


## 3. Chọn số drone, tạo đơn hàng
Đầu tiên chọn số drone muốn mô phỏng(hiện tại đang max 30, có thể fix lại trong fe):

![alt text](doc\image-2.png)

Vào mục:

```text
Đơn hàng
```

Bấm mở phần quản lý đơn hàng.

Hệ thống hỗ trợ 3 cách tạo đơn(chọn 100 đơn rồi tạo ngẫu nhiên cho nó nhanh):
![alt text](doc\image-1.png)
1. Tạo đơn thủ công.
2. Tạo đơn ngẫu nhiên.
3. Import danh sách đơn bằng JSON.

---

## 3.1. Tạo đơn thủ công

Trong phần tạo đơn thủ công, nhập các thông tin:

| Trường            | Ý nghĩa                         |
| ----------------- | ------------------------------- |
| Mã đơn            | ID của đơn hàng                 |
| Vĩ độ lấy hàng    | Tọa độ latitude điểm lấy hàng   |
| Kinh độ lấy hàng  | Tọa độ longitude điểm lấy hàng  |
| Vĩ độ giao hàng   | Tọa độ latitude điểm giao hàng  |
| Kinh độ giao hàng | Tọa độ longitude điểm giao hàng |
| Khối lượng kg     | Khối lượng kiện hàng            |
| Mức ưu tiên       | low, normal, high hoặc urgent   |

Có thể chọn điểm trực tiếp trên bản đồ:

1. Bấm **Chọn điểm lấy hàng trên bản đồ**.
2. Click vào vị trí lấy hàng trên bản đồ.
3. Mở lại modal đơn hàng nếu cần.
4. Bấm **Chọn điểm giao hàng trên bản đồ**.
5. Click vào vị trí giao hàng trên bản đồ.
6. Nhập khối lượng và mức ưu tiên.
7. Bấm **Thêm vào danh sách nháp**.

---

## 3.2. Tạo đơn ngẫu nhiên

Trong phần tạo ngẫu nhiên:

1. Nhập số lượng đơn muốn tạo.
2. Bấm **Tạo ngẫu nhiên**.
3. Hệ thống sẽ tự sinh các cặp điểm lấy hàng/giao hàng hợp lệ trong vùng bản đồ.

Lưu ý:

* Số đơn tạo ngẫu nhiên tối đa thường là 100 đơn/lần.
* Nếu vùng bản đồ nhỏ hoặc có nhiều vùng cấm bay, hệ thống có thể tạo được ít đơn hơn số lượng yêu cầu.
* Các đơn ngẫu nhiên sẽ được thêm vào danh sách đơn nháp.


---

## 3.3. Import đơn hàng bằng JSON

Có thể nhập danh sách đơn theo dạng JSON.

Ví dụ:

```json
[
  {
    "orderId": "order_demo_1",
    "pickup": [21.0064, 105.7768],
    "dropoff": [21.0158, 105.7970],
    "payloadKg": 1.2,
    "priority": "normal"
  },
  {
    "orderId": "order_demo_2",
    "pickup": [21.0109, 105.7715],
    "dropoff": [21.0248, 105.7932],
    "payloadKg": 2.0,
    "priority": "high"
  }
]
```

Sau khi nhập JSON:

1. Bấm import/nạp danh sách.
2. Kiểm tra danh sách đơn nháp.
3. Nếu dữ liệu hợp lệ, đơn sẽ được thêm vào danh sách nháp.

Lưu ý:

* Mỗi đơn cần có `pickup`, `dropoff`, `payloadKg`.
* `pickup` và `dropoff` là mảng `[lat, lon]`.
* `priority` có thể là `low`, `normal`, `high`, `urgent`.
* Nên giới hạn số đơn import để demo mượt.

---

## 4. Bắt đầu mô phỏng

Sau khi đã có danh sách đơn nháp hợp lệ:

1. Chọn số lượng UAV muốn chạy.
2. Kiểm tra server và worker đã kết nối.
3. Bấm **Bắt đầu mô phỏng**.

Khi bắt đầu, hệ thống sẽ:

1. Gửi yêu cầu mô phỏng tới broker.
2. Broker phân phối mô phỏng tới worker.
3. Worker khởi tạo map, UAV và đơn hàng.
4. Hệ thống tự động phân công đơn hàng cho UAV.
5. UAV bắt đầu bay tới điểm lấy hàng, sau đó tới điểm giao hàng.

Nếu dùng nhiều worker, broker có thể chia mô phỏng thành nhiều shard để chạy nhiều UAV hơn.



![alt text](doc\image-3.png)
![alt text](doc\image-4.png)
---

## 5. Điều khiển mô phỏng

Trong quá trình mô phỏng, có thể dùng các nút điều khiển:

| Nút      | Ý nghĩa                                      |
| -------- | -------------------------------------------- |
| Bắt đầu  | Khởi động mô phỏng với đơn hàng hiện tại     |
| Tạm dừng | Tạm dừng mô phỏng                            |
| Tiếp tục | Tiếp tục mô phỏng sau khi tạm dừng           |
| Reset    | Đưa hệ thống về trạng thái thiết lập ban đầu |

Lưu ý:
* **Reset** dùng khi muốn xóa trạng thái hiện tại và chuẩn bị demo lại từ đầu.
* Sau khi reset, cần tạo hoặc nạp lại đơn hàng trước khi chạy mô phỏng mới.

---

## 7. Xem UAV trên bản đồ

Trên bản đồ, mỗi UAV được hiển thị bằng marker riêng.

Có thể click vào UAV để xem:

* Mã UAV.
* Trạng thái UAV.
* Pin.
* Tốc độ.
* Độ cao.
* Đơn hàng đang xử lý.
* Nhiệm vụ hiện tại.
* Điểm đến hiện tại.
* Tải trọng.
* Quãng đường còn lại.
* Thời gian dự kiến.

Thông tin này hiển thị ở panel dưới bản đồ.

![alt text](doc\image-5.png)
---

## 8. Theo dõi tiến trình giao hàng

Khi một UAV nhận đơn, tiến trình thường gồm:

1. Nhận đơn.
2. Bay tới điểm lấy hàng.
3. Lấy hàng.
4. Bay tới điểm giao hàng.
5. Hoàn tất đơn.

Trạng thái đơn hàng có thể gồm:

| Trạng thái      | Ý nghĩa                        |
| --------------- | ------------------------------ |
| pending         | Đơn đang chờ phân công         |
| assigned        | Đơn đã được gán cho UAV        |
| going_to_pickup | UAV đang bay tới điểm lấy hàng |
| picked_up       | UAV đã lấy hàng                |
| delivering      | UAV đang giao hàng             |
| completed       | Đơn đã hoàn thành              |
| failed          | Đơn thất bại                   |

Trong panel chi tiết, có thể xem đơn liên kết, nhiệm vụ liên kết và UAV phụ trách.

![alt text](doc\image-6.png)

---

## 9. Xem danh sách UAV

Vào mục:

```text
UAV
```

Tại đây có thể xem danh sách các UAV đang có trong hệ thống.

Khi chọn một UAV trong danh sách:

* Bản đồ sẽ focus/hiển thị UAV tương ứng.
* Panel chi tiết sẽ hiển thị thông tin UAV.
* Tuyến bay và lịch sử bay của UAV được hiển thị nếu layer tương ứng đang bật.

![alt text](doc\image-7.png)

---

## 10. Xem và chỉnh môi trường

Vào mục:

```text
Môi trường
```

Có thể chỉnh các yếu tố môi trường:

| Tham số             | Ý nghĩa                                             |
| ------------------- | --------------------------------------------------- |
| Hướng gió           | Hướng gió tác động lên UAV                          |
| Tốc độ gió          | Gió càng mạnh thì tiêu hao năng lượng càng thay đổi |
| Nhiệt độ môi trường | Ảnh hưởng tới nhiệt độ UAV và mức tiêu hao          |
| Mưa                 | Khi bật mưa, UAV bay chậm hơn và tiêu hao nhiều hơn |

Sau khi chỉnh, bấm **Áp dụng môi trường**.

Khi áp dụng môi trường:

* Worker cập nhật điều kiện mô phỏng.
* UAV có thể được tính lại đường bay.
* Pin, tốc độ, nhiệt độ và thời gian dự kiến có thể thay đổi.



![alt text](doc\image-8.png)

---

## 11. Tạo vật cản động

Vào mục:

```text
Bản đồ
```

hoặc phần công cụ bản đồ/môi trường tùy giao diện hiện tại.

Để tạo vật cản:

1. Chọn loại vật cản.
2. Nhập bán kính.
3. Nhập chiều cao.
4. Bấm công cụ đặt vật cản.
5. Click vào vị trí muốn đặt trên bản đồ.

Sau khi thêm vật cản:

* Vật cản sẽ xuất hiện trên bản đồ.
* Khi UAV phát hiện vật cản, hệ thống có thể tính lại đường bay.
* Sự kiện phát hiện vật cản và tính lại đường bay sẽ xuất hiện trong nhật ký.



![alt text](doc\image-9.png)
![alt text](doc\image-10.png)



## 12. Tạo vùng cấm bay

Vào mục:

```text
Bản đồ
```

Để tạo vùng cấm bay:

1. Chọn công cụ vùng cấm bay.
2. Nhập bán kính vùng cấm.
3. Nhập chiều cao giới hạn.
4. Click vào vị trí muốn đặt vùng cấm bay trên bản đồ.

Sau khi thêm vùng cấm bay:

* Vùng cấm bay sẽ được hiển thị trên bản đồ.
* Các UAV đang hoạt động sẽ được tính lại đường bay nếu tuyến hiện tại bị ảnh hưởng.
* Nếu không tìm được đường bay an toàn, UAV hoặc nhiệm vụ có thể bị báo lỗi.



---

## 13. Bật/tắt các lớp hiển thị bản đồ

Trong phần layer/bản đồ, có thể bật hoặc tắt các lớp hiển thị.

Các layer thường dùng:

| Layer        | Ý nghĩa                                                   |
| ------------ | --------------------------------------------------------- |
| UAV          | Hiển thị UAV trên bản đồ                                  |
| Đơn hàng     | Hiển thị điểm lấy hàng và điểm giao hàng                  |
| Tuyến bay    | Hiển thị đường bay dự kiến                                |
| Lịch sử bay  | Hiển thị đường UAV đã đi qua                              |
| Tòa nhà      | Hiển thị lớp công trình/tòa nhà                           |
| Vật cản      | Hiển thị vật cản động                                     |
| Vùng cấm bay | Hiển thị vùng cấm bay                                     |
| Vùng cản gió | Hiển thị khu vực bị ảnh hưởng bởi công trình và hướng gió |
| Nhãn tòa nhà | Hiển thị nhãn/tên tòa nhà nếu có                          |

Lưu ý:

* Nếu bản đồ bị rối, nên tắt bớt layer không cần thiết.
* Khi demo, nên bật UAV, đơn hàng, tuyến bay, lịch sử bay, vùng cấm bay và vật cản.
* Layer tòa nhà và vùng cản gió có thể bật khi muốn giải thích yếu tố 2.5D và môi trường.


![alt text](doc\image-11.png)

---

## 14. Xem nhật ký sự kiện

Vào mục:

```text
Sự kiện
```

hoặc xem panel sự kiện phía dưới/phải.

Nhật ký sự kiện ghi lại các hoạt động như:

* Worker kết nối.
* Bắt đầu mô phỏng.
* Nhận danh sách đơn hàng.
* Tạo nhiệm vụ.
* Phân công UAV.
* UAV tới điểm lấy hàng.
* UAV lấy hàng.
* UAV giao hàng.
* Đơn hoàn thành.
* Thêm vật cản.
* Thêm vùng cấm bay.
* Tính lại đường bay.
* Lỗi map cache hoặc worker.

Có thể lọc sự kiện theo:

| Bộ lọc             | Ý nghĩa                                     |
| ------------------ | ------------------------------------------- |
| Tất cả             | Hiển thị toàn bộ sự kiện                    |
| UAV đang chọn      | Chỉ hiển thị sự kiện của UAV đang chọn      |
| Đơn đang chọn      | Chỉ hiển thị sự kiện của đơn hàng đang chọn |
| Nhiệm vụ đang chọn | Chỉ hiển thị sự kiện của nhiệm vụ đang chọn |



![alt text](doc\image-12.png)

---

## 15. Luồng demo khuyến nghị

Để demo nhanh và dễ hiểu, nên đi theo thứ tự:

1. Mở app tại `http://localhost:3000`.
2. Chọn số drone.
3. Mở mục **Bản đồ** và giới thiệu khu vực mô phỏng.
4. Mở mục **Đơn hàng**.
5. Tạo 10-30 đơn ngẫu nhiên.
7. Bấm **Bắt đầu mô phỏng**.
8. Quan sát UAV được phân công và bắt đầu bay.
9. Click vào một UAV để xem thông tin pin, tốc độ, độ cao, đơn hàng, nhiệm vụ.
10. Bật lịch sử đường bay để thấy UAV đã đi qua đâu.
11. Vào **Môi trường**, tăng gió hoặc bật mưa, sau đó áp dụng.
12. Tạo một vật cản hoặc vùng cấm bay trên tuyến bay.
13. Quan sát UAV tính lại đường bay.
14. Mở **Sự kiện** để giải thích các log hệ thống.
15. Chờ một số đơn hoàn thành và chỉ ra trạng thái `completed`.

---

## 16. Kịch bản demo mẫu

### Kịch bản 1: Demo cơ bản

Mục tiêu: chứng minh hệ thống có thể tự phân công UAV và giao hàng.

Các bước:

1. Tạo 10 đơn ngẫu nhiên.
2. Chọn 5 UAV.
3. Bắt đầu mô phỏng.
4. Click vào từng UAV để xem trạng thái.
5. Chờ một vài đơn hoàn thành.
6. Mở nhật ký sự kiện để xem quá trình nhận đơn, lấy hàng, giao hàng.

### Kịch bản 2: Demo nhiều UAV

Mục tiêu: chứng minh hệ thống chạy được nhiều UAV cùng lúc.

Các bước:

1. Chạy 2 worker.
2. Tạo 30-60 đơn ngẫu nhiên.
3. Chọn 30 UAV.
4. Bắt đầu mô phỏng.
5. Quan sát broker chia tải qua nhiều worker.
6. Theo dõi các UAV hoạt động song song trên bản đồ.

### Kịch bản 3: Demo môi trường

Mục tiêu: chứng minh hệ thống phản ứng với thời tiết.

Các bước:

1. Bắt đầu mô phỏng với khoảng 10 UAV.
2. Vào mục **Môi trường**.
3. Tăng tốc độ gió.
4. Bật mưa.
5. Bấm áp dụng.
6. Quan sát tốc độ, pin, nhiệt độ và tuyến bay thay đổi.

### Kịch bản 4: Demo vùng cấm bay/vật cản

Mục tiêu: chứng minh hệ thống có khả năng tránh vùng nguy hiểm.

Các bước:

1. Bắt đầu mô phỏng.
2. Chọn công cụ tạo vùng cấm bay.
3. Đặt vùng cấm bay gần tuyến bay hiện tại.
4. Quan sát UAV tính lại đường.
5. Mở nhật ký sự kiện để xem sự kiện replan.
6. Tiếp tục đặt vật cản động để demo khả năng phản ứng.

---

## 17. Một số lưu ý khi demo

* Nên bắt đầu với 5-15 UAV để demo mượt.
* Nếu muốn chạy 30 UAV, nên bật 2 worker.
* Không nên bật quá nhiều layer cùng lúc nếu bản đồ bị rối.
* Nếu muốn giải thích thuật toán, bật tuyến bay, lịch sử bay, tòa nhà, vùng cấm bay.
* Nếu muốn giải thích nghiệp vụ giao hàng, tập trung vào đơn hàng, UAV đang chọn và tiến trình nhiệm vụ.
* Nếu muốn giải thích hệ thống realtime, mở nhật ký sự kiện và thanh trạng thái worker/server.
* Nếu mô phỏng bị lỗi, kiểm tra nhật ký sự kiện trước, sau đó xem log terminal hoặc Docker.
