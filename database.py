import csv
import json
import sqlite3
from datetime import datetime
from typing import Any, Dict, List

from app.config import DB_PATH, VEHICLE_CSV


def get_conn():    # 获取数据库链接
    conn = sqlite3.connect(DB_PATH)    # 链接SQL
    conn.row_factory = sqlite3.Row    # factory结果转为字典
    return conn


def init_db():     # 初始化数据库，建立多个表
    with get_conn() as conn:
        conn.executescript(
            """ 
            CREATE TABLE IF NOT EXISTS vehicles(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                brand TEXT,
                model TEXT,
                vehicle_type TEXT,
                energy_type TEXT,
                price_min INTEGER,
                price_max INTEGER,
                cltc_range INTEGER,
                battery_kwh REAL,
                fast_charge_minutes INTEGER,
                seats INTEGER,
                drive_type TEXT,
                adas_level TEXT,
                smart_cockpit TEXT,
                wheelbase INTEGER,
                trunk_volume INTEGER,
                safety_score REAL,
                monthly_sales INTEGER,
                suitable_scenarios TEXT,
                highlights TEXT,
                weaknesses TEXT
            );
            CREATE TABLE IF NOT EXISTS leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT,
                name TEXT,
                phone_masked TEXT,
                profile_json TEXT,
                budget INTEGER,
                city TEXT,
                concerns TEXT,
                intent_level TEXT,
                recommended_models TEXT,
                next_action TEXT
            );
            CREATE TABLE IF NOT EXISTS recommendation_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT,
                user_query TEXT,
                profile_json TEXT,
                result_json TEXT,
                top_model TEXT,
                confidence REAL
            );
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT,
                updated_at TEXT,
                summary TEXT
            );
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER,
                role TEXT,
                content TEXT,
                created_at TEXT
            );
            """
        )
        db_count = conn.execute("SELECT COUNT(*) AS c FROM vehicles").fetchone()["c"]    # 查询数据库中vehicles的数量“count(*)”只返回一行，fetchone直取第一行
        with VEHICLE_CSV.open("r", encoding="utf-8-sig", newline="") as f:
            csv_count = sum(1 for _ in csv.DictReader(f))    # 查询统计csv的内容数量
        if db_count != csv_count:
            conn.execute("DELETE FROM vehicles")    # SQL命令 删除表中数据
            seed_vehicles(conn)     # 重新填充表 函数定义在下方


def seed_vehicles(conn):   # 定义填充表的函数
    with VEHICLE_CSV.open("r", encoding="utf-8-sig", newline="") as f:    # 读取csv 上下文管理器  with确保读取完后立即关闭
        rows = list(csv.DictReader(f))    # 将每行转化为字典，csv的表头作为健，然后转化成列表形式方便后续遍历
    for row in rows:
        conn.execute(
            """
            INSERT INTO vehicles (
                brand, model, vehicle_type, energy_type, price_min, price_max, cltc_range,
                battery_kwh, fast_charge_minutes, seats, drive_type, adas_level, smart_cockpit,
                wheelbase, trunk_volume, safety_score, monthly_sales, suitable_scenarios,
                highlights, weaknesses
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["brand"], row["model"], row["vehicle_type"], row["energy_type"],
                int(row["price_min"]), int(row["price_max"]), int(row["cltc_range"]),
                float(row["battery_kwh"]), int(row["fast_charge_minutes"]), int(row["seats"]),
                row["drive_type"], row["adas_level"], row["smart_cockpit"], int(row["wheelbase"]),
                int(row["trunk_volume"]), float(row["safety_score"]), int(row["monthly_sales"]),
                row["suitable_scenarios"], row["highlights"], row["weaknesses"],
            ),
        )     # 将数据对应插入到表中   结尾values占位符？防止注入攻击  从csv中读取的都是字符串，所以需要转化数据类型
              # “”“  ”“” SQL语句 首先指定要插入的字段名 然后设置占位符 最后后面的值会替换占位符


def rows_to_dicts(rows) -> List[Dict[str, Any]]:    # 将数据库查询结果（Row 对象列表）转换为字典列表 ，方便序列化和返回给前端。
    return [dict(row) for row in rows]


def list_vehicles() -> List[Dict[str, Any]]:
    with get_conn() as conn:   # 上下文管理器 连接数据库 然后使用完自动关闭
        return rows_to_dicts(conn.execute("SELECT * FROM vehicles ORDER BY monthly_sales DESC").fetchall())
        # SQL.execute是SQL执行语句 可以设置具体执行内容 SELECT * FROM vehicles查询所有字段 按照价格降序排列 fetchall获取所有结果行

def find_vehicles_by_models(models: List[str]) -> List[Dict[str, Any]]:
    vehicles = list_vehicles()
    result = []
    for name in models:    # 遍历models
        for vehicle in vehicles:    # 遍历
            full_name = f"{vehicle['brand']} {vehicle['model']}"    # 构造参数 完整的名称是brand+model
            if name.lower() in full_name.lower() or vehicle["model"].lower() in name.lower():  # 把名称都转为小写然后查找
                if vehicle not in result:
                    result.append(vehicle)
    return result    # 返回查找到的车辆数据


def match_mentioned_vehicles(query: str) -> List[Dict[str, Any]]:    # 匹配用户查询的内容提到的车型
    text = (query or "").lower().replace(" ", "")    #  对用户输入内容query处理空值 转为小写  去除空格
    vehicles = list_vehicles()   # 获取全部车型数据
    result = []   # 创建列表准备存放匹配的车型

    def add_if(predicate):    # predicate是一个条件函数
        for item in vehicles:
            if predicate(item) and item not in result:   # predicate(item)判断车型是否符合条件
                result.append(item)

    if any(alias in text for alias in ["e300l", "e300", "奔驰e", "奔驰e级"]):    # any函数只要迭代器中有一个元素为True就返回true
        add_if(lambda v: v["brand"] == "奔驰" and v["model"] == "E300L")    # 筛选品牌和型号
    if any(alias in text for alias in ["宝马5", "5系", "宝马五系", "530li"]):
        add_if(lambda v: v["brand"] == "宝马" and v["model"] == "530Li")
    if any(alias in text for alias in ["model3", "model 3", "特斯拉3"]):
        add_if(lambda v: v["brand"] == "特斯拉" and v["model"] == "Model 3")
    if any(alias in text for alias in ["modely", "model y"]):
        add_if(lambda v: v["brand"] == "特斯拉" and v["model"] == "Model Y")
    if "享界s9增程" in text:
        add_if(lambda v: v["brand"] == "享界" and v["model"] == "S9增程")
    elif "享界s9" in text:
        add_if(lambda v: v["brand"] == "享界" and v["model"] == "S9")
    if "尊界s800" in text:
        add_if(lambda v: v["brand"] == "尊界" and v["model"] == "S800")
    for brand, models in {"问界": ["M5", "M7", "M8", "M9"], "智界": ["S7", "R7"]}.items():
        for model in models:
            if f"{brand}{model}".lower() in text:
                add_if(lambda v, b=brand, m=model: v["brand"] == b and v["model"] == m)

    for vehicle in vehicles:
        model_key = vehicle["model"].lower().replace(" ", "")    # 将车型名转小写去空格
        names = [f"{vehicle['brand']}{vehicle['model']}".lower().replace(" ", "")]    # 构造车型关键词完整车名
        if len(model_key) >= 2:
            names.append(model_key)
        if any(alias.lower().replace(" ", "") in text for alias in names):    # 再次匹配
            if vehicle not in result:
                result.append(vehicle)    # 再次匹配用户对话防止漏掉关键词
    return result


def save_recommendation_log(query: str, profile: Dict, result: List[Dict]):    # 将记录保存到数据库日志用于数据分析用户行为追踪
    top_model = f"{result[0]['brand']} {result[0]['model']}" if result else ""  #返回推荐列表中第一个推荐的品牌车型 如果没有返回空
    confidence = float(result[0].get("score", 0)) if result else 0  # 获取第一个结果的score置信度 没有就返回0
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO recommendation_logs (created_at, user_query, profile_json, result_json, top_model, confidence) VALUES (?, ?, ?, ?, ?, ?)",
            (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), query, json.dumps(profile, ensure_ascii=False), json.dumps(result, ensure_ascii=False), top_model, confidence),
        )    # 插入数据库将  对应的日志插入到数据库中 记录画像 车型 得分


def create_lead(data: Dict):    # 创建销售线索记录  data是客户信息字典 前端点击推荐会调用api把画像和车型作为data传入
    profile = data.get("profile", {})    # 提取画像 画像没有的话就默认返回空字典
    with get_conn() as conn:    # 插入数据库存入 用户销售线索
        cur = conn.execute(
            """
            INSERT INTO leads (created_at, name, phone_masked, profile_json, budget, city, concerns, intent_level, recommended_models, next_action)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                data.get("name", "匿名客户"),
                data.get("phone_masked", ""),
                json.dumps(profile, ensure_ascii=False),
                profile.get("budget_max") or 0,    # 预算上限
                profile.get("city", ""),
                ",".join(profile.get("concerns", [])),
                profile.get("intent_level", "了解中"),
                ",".join(data.get("recommended_models", [])),
                data.get("next_action", ""),
            ),
        )
        return {"id": cur.lastrowid, **data}    # 数据库生成的id和原始数据存到一个字典  **data可以把data内容展开和前面内容一起形成字典


def list_leads() -> List[Dict[str, Any]]:    # 从数据库查询销售线索 按id从高到低排序
    with get_conn() as conn:
        return rows_to_dicts(conn.execute("SELECT * FROM leads ORDER BY id DESC").fetchall())


def list_recommendation_logs() -> List[Dict[str, Any]]:    # 查询最近两百条日志
    with get_conn() as conn:
        return rows_to_dicts(conn.execute("SELECT * FROM recommendation_logs ORDER BY id DESC LIMIT 200").fetchall())


def clear_runtime_data():
    with get_conn() as conn:
        conn.execute("DELETE FROM leads")
        conn.execute("DELETE FROM recommendation_logs")
        conn.execute("DELETE FROM chat_sessions")
        conn.execute("DELETE FROM chat_messages")
    return {"status": "ok"}
