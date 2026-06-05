import re
from typing import Dict, List

from envs.myenv.Lib.unittest import result

from app.database import list_vehicles, match_mentioned_vehicles
from app.schemas import UserProfile


def normalize_profile(query: str, profile: UserProfile) -> Dict:    # 将默认的用户画像profile补全用户画像profile
    data = profile.model_dump()    # model_dump 将模型转为字典
    text = query or ""    # 获取用户输入内容去除空值

    budget_match = re.search(r"(\d+(?:\.\d+)?)\s*(万|w|W)", text)    # 正则表达式寻找 最大预算
    if budget_match and not data.get("budget_max"):
        data["budget_max"] = int(float(budget_match.group(1)) * 10000)    # 如过data没有获取到budget_max哪个他就等于budget_match

    km_match = re.search(r"通勤.*?(\d+(?:\.\d+)?)\s*(公里|km|KM)", text) # 正则寻找通勤里程
    if km_match and not data.get("commute_km"):
        data["commute_km"] = float(km_match.group(1))    # 同上

    people_match = re.search(r"(\d)\s*(口|人|个).*?(家|家庭)", text)    # 正则寻找家庭人数
    if people_match and not data.get("family_size"):
        data["family_size"] = int(people_match.group(1))    # 同上
    if "三口" in text and not data.get("family_size"):
        data["family_size"] = 3
    if "二胎" in text and not data.get("family_size"):
        data["family_size"] = 4    # 通过特殊文字提取家庭人数

    if any(x in text for x in ["家充", "充电桩", "固定车位"]):    # 判断是否有充电桩
        data["has_home_charger"] = True
    elif any(x in text for x in ["没有家充", "不能装充电桩", "无家充"]):
        data["has_home_charger"] = False

    if not data.get("preferred_type"):    # 判断车型偏好
        for item in ["SUV", "轿车", "MPV", "旅行车", "猎装车", "跑车", "轿跑"]:
            if item.lower() in text.lower():
                data["preferred_type"] = item
                break
        if not data.get("preferred_type") and "豪车" in text:
            data["preferred_type"] = "豪车"

    if not data.get("preferred_energy"):    # 能源类型偏好
        if "纯电" in text:
            data["preferred_energy"] = "纯电"
        elif "插混" in text or "混动" in text:
            data["preferred_energy"] = "插混"
        elif "增程" in text:
            data["preferred_energy"] = "增程"

    concern_map = {
        "续航": ["续航", "长途", "高速"],
        "安全": ["安全", "电池", "自燃"],
        "智驾": ["智驾", "辅助驾驶", "智能驾驶", "NOA"],
        "空间": ["空间", "后排", "后备箱", "小孩", "家庭"],
        "性价比": ["性价比", "便宜", "预算", "价格"],
        "补能": ["充电", "家充", "补能", "快充"],
        "保值": ["保值", "二手"],
    }
    concerns = set(data.get("concerns") or [])    # 关注点提取
    if any(word in text for word in ["撩妹", "泡妞", "约会", "面子", "牌面", "社交"]):    # 根据给出的提示词更新关注点
        concerns.update({"社交形象", "内饰氛围", "品牌"})
    for label, words in concern_map.items():
        if any(word in text for word in words):    # 提取关注点内容
            concerns.add(label)
    data["concerns"] = list(concerns)    # 输入关注点列表

    for brand in ["比亚迪", "特斯拉", "小鹏", "理想", "问界", "享界", "尊界", "智界", "蔚来", "极氪", "吉利", "长安", "大众", "宝马", "奔驰", "奥迪", "小米", "阿维塔"]:
        if brand in text and brand not in data.get("preferred_brands", []):
            data.setdefault("preferred_brands", []).append(brand)    # 品牌偏好提取

    mentioned = match_mentioned_vehicles(text)
    data["mentioned_models"] = [f"{item['brand']} {item['model']}" for item in mentioned]
    if mentioned:
        data["explicit_vehicle_compare"] = True
        data["preferred_type"] = ""
        data["preferred_energy"] = ""

    if any(word in text for word in ["试驾", "近期买", "准备买", "订车"]):
        data["intent_level"] = "高意向"
    elif any(word in text for word in ["对比", "纠结", "怎么选", "哪个更适合", "哪款更适合"]):
        data["intent_level"] = "对比中"    # 意向调查

    return data


def score_vehicle(vehicle: Dict, profile: Dict) -> Dict:    # 很具用户画像计算每辆车的置信度
    budget_max = profile.get("budget_max") or 300000   # 获取一定值如果没有就设置默认值
    budget_min = profile.get("budget_min") or 0
    commute_km = profile.get("commute_km") or 40
    family_size = profile.get("family_size") or 3
    concerns = profile.get("concerns") or []
    mentioned_models = profile.get("mentioned_models") or []
    full_name = f"{vehicle['brand']} {vehicle['model']}"
    is_mentioned = full_name in mentioned_models

    mid_price = (vehicle["price_min"] + vehicle["price_max"]) / 2
    if is_mentioned:    # 如果明确提到车型那么久设置为88分
        budget_score = 88
    elif vehicle["price_min"] <= budget_max and vehicle["price_max"] >= budget_min:   # 如果价格在预算范围内超出越多扣分越多
        budget_score = 100 - max((mid_price - budget_max) / max(budget_max, 1) * 40, 0)
    else:
        budget_score = max(30, 100 - abs(mid_price - budget_max) / max(budget_max, 1) * 100)    # 不在预算内最低三十分

    range_need = max(commute_km * 7, 350)    # 续航需求
    if vehicle["energy_type"] == "燃油":    # 燃油车固定86分
        range_score = 86
    else:
        range_score = min(vehicle["cltc_range"] / range_need * 100, 100) # 续航里程、需求里程

    space_base = 75    # 空间匹配度基础分
    if family_size >= 4:
        space_base += 10 if vehicle["seats"] >= 5 and vehicle["wheelbase"] >= 2900 else -5
    if vehicle["vehicle_type"] in {"SUV", "MPV"}:
        space_base += 10
    space_score = min(max(space_base, 40), 100)

    has_home_charger = profile.get("has_home_charger")    # 充电匹配度
    if vehicle["energy_type"] == "燃油":
        charging_score = 82
    elif has_home_charger is True:
        charging_score = 92 if vehicle["energy_type"] == "纯电" else 84
    elif has_home_charger is False:
        charging_score = 94 if vehicle["energy_type"] in {"插混", "增程"} else 72
    else:
        charging_score = 82

    smart_score = 92 if "+" in vehicle["adas_level"] else 78    # 智能驾驶匹配度
    if "智驾" in concerns:
        smart_score += 6
    safety_score = min(float(vehicle["safety_score"]), 100)    # 安全评分直接调用数据库

    scenario_score = 75    # 场景匹配度
    scenario_text = f"{vehicle['suitable_scenarios']};{vehicle['highlights']};{vehicle['brand']};{vehicle['model']}"
    for concern in concerns:
        if concern in scenario_text or concern in vehicle["highlights"]:
            scenario_score += 5
    if profile.get("preferred_type") and profile["preferred_type"] in vehicle["vehicle_type"]:
        scenario_score += 8
    if profile.get("preferred_energy") and profile["preferred_energy"] == vehicle["energy_type"]:
        scenario_score += 8
    if profile.get("preferred_brands") and vehicle["brand"] in profile["preferred_brands"]:
        scenario_score += 8
    if is_mentioned:
        scenario_score += 24
    scenario_score = min(scenario_score, 100)

    total = (
        budget_score * 0.25
        + range_score * 0.20
        + space_score * 0.15
        + charging_score * 0.15
        + smart_score * 0.10
        + safety_score * 0.10
        + scenario_score * 0.05
    )          # 综合评分 加权平均

    reasons = [
        f"预算匹配度 {budget_score:.0f} 分",
        f"续航匹配度 {range_score:.0f} 分",
        f"空间匹配度 {space_score:.0f} 分",
    ]                                         #  生成推荐理由reasons
    if has_home_charger is False and vehicle["energy_type"] in {"插混", "增程"}:
        reasons.append("无家充场景下补能更稳妥")
    if "智驾" in concerns and "+" in vehicle["adas_level"]:
        reasons.append("智能驾驶能力更贴合关注点")
    if "空间" in concerns and vehicle["vehicle_type"] == "SUV":
        reasons.append("SUV 空间和家庭实用性较强")
    if is_mentioned:
        reasons.insert(0, "用户问题中明确点名该车型，已优先纳入对比")
    if "社交形象" in concerns:
        if vehicle["brand"] in {"奔驰", "宝马", "奥迪"}:
            reasons.append("豪华品牌在社交形象和商务场景中识别度更高")
        elif vehicle["brand"] in {"特斯拉", "小米", "阿维塔", "享界", "尊界", "智界"}:
            reasons.append("科技品牌和新能源属性更容易体现年轻化与科技感")

    cautions = []    # 生成注意事项
    if vehicle["price_min"] > budget_max:
        cautions.append("入门价格高于当前预算，需要确认金融方案或调整预算")
    if vehicle["energy_type"] == "纯电" and has_home_charger is False:
        cautions.append("无家充时需要确认公共充电便利性")
    if vehicle["cltc_range"] < 550 and "续航" in concerns:
        cautions.append("续航关注度较高，建议试驾并核算实际续航")
    if vehicle["weaknesses"]:
        cautions.append(vehicle["weaknesses"])

    return {
        **vehicle,
        "score": round(total, 1),
        "budget_score": round(budget_score, 1),
        "range_score": round(range_score, 1),
        "space_score": round(space_score, 1),
        "charging_score": round(charging_score, 1),
        "smart_score": round(min(smart_score, 100), 1),
        "safety_score": round(safety_score, 1),
        "scenario_score": round(scenario_score, 1),
        "reasons": reasons,
        "cautions": cautions[:3],
    }  # 返回车型数据字典同时给出各个数据加权计算后评分


def recommend(query: str, profile: UserProfile, top_k: int = 5) -> Dict:    # 根据评分返回推荐车型
    normalized = normalize_profile(query, profile)    # 补全后的用户画像
    vehicles = list_vehicles()    # 所有车型
    scored = [score_vehicle(vehicle, normalized) for vehicle in vehicles]    # 每种车型的评分
    mentioned_names = set(normalized.get("mentioned_models") or [])    # 用户画像中提到了车型
    if mentioned_names:
        mentioned = [item for item in scored if f"{item['brand']} {item['model']}" in mentioned_names]
        others = [item for item in scored if f"{item['brand']} {item['model']}" not in mentioned_names]
        mentioned.sort(key=lambda x: x["score"], reverse=True)
        others.sort(key=lambda x: x["score"], reverse=True)
        scored = mentioned + others
    else:
        scored.sort(key=lambda x: x["score"], reverse=True)
    return {"profile": normalized, "recommendations": scored[:top_k]}    # 提到的车型排在前面没有提到的车型按顺序排序
