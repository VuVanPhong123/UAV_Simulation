import osmnx as ox
import networkx as nx
import geopandas as gpd
import numpy as np

ANCHOR_LAT = 21.0285
ANCHOR_LNG = 105.8542
RADIUS_METERS = 500

def build_map():
    print("1. Đang tải mạng lưới đồ thị từ OpenStreetMap...")
    G = ox.graph_from_point((ANCHOR_LAT, ANCHOR_LNG), dist=RADIUS_METERS, network_type='all')
    
    G_proj = ox.project_graph(G)
    
    print(f"-> Đã tải xong đồ thị với {len(G_proj.nodes)} node và {len(G_proj.edges)} cạnh.")

    print("\n2. Đang tải dữ liệu tòa nhà (Buildings)...")
    tags = {'building': True}
    buildings = ox.features_from_point((ANCHOR_LAT, ANCHOR_LNG), tags=tags, dist=RADIUS_METERS)
    print("\n2. Đang tải dữ liệu tòa nhà (Buildings)...")
    tags = {'building': True}
    buildings = ox.features_from_point((ANCHOR_LAT, ANCHOR_LNG), tags=tags, dist=RADIUS_METERS)
    
    buildings_proj = buildings.to_crs(G_proj.graph['crs'])
    
    print(f"-> Tìm thấy {len(buildings_proj)} công trình.")

    print("\n3. Đang nội suy chiều cao tòa nhà...")
    def estimate_height(row):
        # Nếu có tag height (chiều cao mét)
        if 'height' in row and not pd.isna(row['height']):
            try: return float(str(row['height']).replace('m', '').strip())
            except: pass
        
        # Nếu có tag building:levels (số tầng) -> nhân 3.5m mỗi tầng
        if 'building:levels' in row and not pd.isna(row['building:levels']):
            try: return float(row['building:levels']) * 3.5
            except: pass
        
        # Giá trị mặc định (Ví dụ: nhà phố trung bình 12m)
        return 12.0

    import pandas as pd
    buildings_proj['estimated_height'] = buildings_proj.apply(estimate_height, axis=1)
    
    # Lọc lại chỉ giữ các cột cần thiết để tối ưu dung lượng
    buildings_clean = buildings_proj[['geometry', 'estimated_height']]
    
    print("\n4. Lưu dữ liệu cục bộ...")
    # Lưu đồ thị Graph (cho đường bay)
    ox.save_graphml(G_proj, filepath='hanoi_uav_network.graphml')
    buildings_clean.to_file("hanoi_buildings.geojson", driver="GeoJSON")
    
    print("HOÀN TẤT! Đã tạo xong hanoi_uav_network.graphml và hanoi_buildings.geojson")

if __name__ == "__main__":
    build_map()