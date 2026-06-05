import re
from typing import Dict, List

from openai import OpenAI

from app.config import CHAT_MODEL, OPENAI_API_KEY, OPENAI_BASE_URL, TEMPERATURE
from app.database import save_recommendation_log
from app.schemas import RecommendRequest, RecommendResponse, UserProfile
from app.services.skills import skills


def join_sources(sources: List[Dict]) -> str:    # 创建来源列表
    lines = []
    for i, src in enumerate(sources, 1):
        if src.get("source") == "web":    # 判断是否是网络来源
            lines.append(f"[{i}] Web：{src.get('title')} {src.get('url', '')}")
        else:    # 知识库来源
            lines.append(f"[{i}] {src['source']} | {src['domain']}：{src['content'][:220]}")
    return "\n".join(lines)      # 将来源列表格式化为可引用的文本，用于 AI 生成回答时的证据引用。


def detect_recommend_scene(query: str, profile: Dict) -> str:    # 接收用户输入内容以及用户画像
    text = f"{query} {profile.get('preferred_type', '')} {' '.join(profile.get('concerns') or [])}".lower()  # 拼接消息并转为小写
    social_words = ["泡妞", "撩妹", "约会", "社交", "面子", "牌面", "豪车", "跑车", "轿跑", "性能车", "amg", "保时捷", "m2"]
    family_words = ["三口", "家庭", "家用", "小孩", "通勤", "空间", "suv", "露营"]
    if any(word in text for word in social_words):
        return "social_luxury"
    if any(word in text for word in family_words):
        return "family_commute"
    return "general"    # 根据用户输入场景关键词返回 使用场景要求


def build_web_search_query(query: str, scene: str) -> str:    # 建立联网搜索内容
    if scene == "social_luxury":    #
        return f"{query} 年轻人 豪车 跑车 轿跑 价格 参数 推荐 官方"
    return f"{query} 车型 价格 参数 官方"   #返回增强后的搜索内容


EXTERNAL_VEHICLE_CATALOG = [
    {
        "brand": "保时捷", "model": "718 Cayman", "vehicle_type": "跑车", "energy_type": "燃油",
        "price_min": 565000, "price_max": 1578000, "cltc_range": 0, "seats": 2, "score": 86.0,
        "keywords": ["保时捷", "porsche", "718", "cayman", "跑车", "年轻", "社交", "撩妹"],
        "reasons": ["跑车造型和品牌识别度强", "适合强调个性、运动感和社交第一印象"],
        "cautions": ["两座布局实用性有限，购车和维护成本较高"],
    },
    {
        "brand": "宝马", "model": "M2", "vehicle_type": "跑车", "energy_type": "燃油",
        "price_min": 599000, "price_max": 599000, "cltc_range": 0, "seats": 4, "score": 84.0,
        "keywords": ["宝马m2", "bmw m2", "m2", "跑车", "性能", "年轻"],
        "reasons": ["性能取向明确，品牌运动属性强", "比大型豪华轿车更强调驾驶乐趣"],
        "cautions": ["后排和舒适性不如中大型轿车"],
    },
    {
        "brand": "奔驰AMG", "model": "CLE 53", "vehicle_type": "轿跑", "energy_type": "燃油",
        "price_min": 720000, "price_max": 760000, "cltc_range": 0, "seats": 4, "score": 83.0,
        "keywords": ["amg", "奔驰amg", "cle", "轿跑", "豪华", "社交"],
        "reasons": ["奔驰豪华感和 AMG 运动属性兼具", "适合重视品牌、内饰氛围和个性化表达"],
        "cautions": ["价格较高，具体配置和引入版本需以官方为准"],
    },
    {
        "brand": "名爵", "model": "Cyberster", "vehicle_type": "跑车", "energy_type": "纯电",
        "price_min": 319800, "price_max": 359800, "cltc_range": 580, "seats": 2, "score": 82.0,
        "keywords": ["mg cyberster", "cyberster", "名爵", "敞篷", "跑车", "年轻", "纯电跑车"],
        "reasons": ["敞篷纯电跑车视觉冲击强", "价格相比传统豪华跑车更低"],
        "cautions": ["品牌豪华属性弱于保时捷、奔驰、宝马"],
    },
    {
        "brand": "路特斯", "model": "Emira", "vehicle_type": "跑车", "energy_type": "燃油",
        "price_min": 858000, "price_max": 1118000, "cltc_range": 0, "seats": 2, "score": 81.0,
        "keywords": ["lotus", "路特斯", "emira", "跑车", "操控", "年轻"],
        "reasons": ["小众跑车品牌辨识度高，操控标签强", "适合追求个性和稀缺感的用户"],
        "cautions": ["售后网络和日常实用性需重点确认"],
    },
    {
        "brand": "特斯拉", "model": "Model Y L", "vehicle_type": "SUV", "energy_type": "纯电",
        "price_min": 300000, "price_max": 380000, "cltc_range": 650, "seats": 6, "score": 80.0,
        "keywords": ["model y l", "modelyl", "model y-l", "modely-l", "特斯拉modelyl", "六座"],
        "reasons": ["适合关注特斯拉品牌、空间和家庭场景的用户", "可作为 Model Y 的更大空间备选"],
        "cautions": ["具体上市节奏、价格和配置以官方实时信息为准"],
    },
    {
        "brand": "特斯拉", "model": "Model 3", "vehicle_type": "轿车", "energy_type": "纯电",
        "price_min": 235500, "price_max": 339500, "cltc_range": 606, "seats": 5, "score": 84.0,
        "keywords": ["model 3", "model3", "特斯拉model3", "特斯拉 model 3"],
        "reasons": ["品牌认知度高，适合城市通勤和年轻用户", "补能网络成熟，能耗和智能化体验有优势"],
        "cautions": ["后排空间和底盘舒适性需结合试驾判断"],
    },
    {
        "brand": "特斯拉", "model": "Model Y", "vehicle_type": "SUV", "energy_type": "纯电",
        "price_min": 263500, "price_max": 363500, "cltc_range": 688, "seats": 5, "score": 85.0,
        "keywords": ["model y", "modely", "特斯拉modely", "特斯拉 model y"],
        "reasons": ["SUV 空间更适合家庭和多场景使用", "补能便利性、保值率和品牌认知度突出"],
        "cautions": ["价格和权益波动较快，需核验官方实时政策"],
    },
    {
        "brand": "奔驰", "model": "E300L", "vehicle_type": "轿车", "energy_type": "燃油",
        "price_min": 500000, "price_max": 600000, "cltc_range": 0, "seats": 5, "score": 82.0,
        "keywords": ["e300l", "e 300 l", "奔驰e300l", "奔驰 e300l", "奔驰e级", "mercedes e"],
        "reasons": ["豪华行政轿车形象稳定，内饰氛围和商务属性强", "适合重视品牌、舒适性和社交场景的用户"],
        "cautions": ["购置税、保险和保养成本高于多数新能源车型"],
    },
    {
        "brand": "宝马", "model": "5系", "vehicle_type": "轿车", "energy_type": "燃油",
        "price_min": 430000, "price_max": 560000, "cltc_range": 0, "seats": 5, "score": 81.0,
        "keywords": ["宝马5系", "宝马 5系", "bmw 5", "bmw 5 series", "525li", "530li"],
        "reasons": ["品牌运动属性和豪华行政定位兼具", "适合喜欢驾驶质感且兼顾商务形象的用户"],
        "cautions": ["终端优惠和配置差异较大，需要结合当地经销商政策核验"],
    },
]    # 预设的车型目录 如果联网搜索无法找到 那就从这里找


def filter_external_candidates(candidates: List[Dict], profile: Dict) -> List[Dict]:
    budget_max = profile.get("budget_max")    # 获取最大预算
    preferred_type = profile.get("preferred_type") or ""    # 获取偏好车类型
    filtered = []    # 存储过滤结果
    for item in candidates:
        if budget_max and item["price_min"] > budget_max * 1.25:    # 跳过预算超过125%的车型
            continue
        if preferred_type in {"跑车", "轿跑"} and item["vehicle_type"] not in {"跑车", "轿跑"}:     #跳过不考虑的车型
            continue
        if preferred_type == "豪车" and item["brand"] not in {"保时捷", "奔驰AMG", "奔驰", "宝马", "路特斯", "特斯拉"}:  # 跳过不合适的车型
            continue
        filtered.append(item)
    return filtered or candidates    # 返回过滤结果，如果没有合适结果就返回所有车型


def external_candidate_to_card(item: Dict, source: Dict) -> Dict:    # 接受item外部候选车型数据 source联网搜索内容
    return {
        "id": -1000 - abs(hash(item["brand"] + item["model"])) % 100000,    # 计算哈希值
        "brand": item["brand"],
        "model": item["model"],
        "vehicle_type": item["vehicle_type"],
        "energy_type": item["energy_type"],
        "price_min": item["price_min"],
        "price_max": item["price_max"],
        "cltc_range": item["cltc_range"],
        "seats": item["seats"],
        "score": item["score"],
        "budget_score": 0.0,
        "range_score": 0.0,
        "space_score": 0.0,
        "charging_score": 0.0,
        "smart_score": 0.0,
        "safety_score": 0.0,
        "scenario_score": item["score"],
        "reasons": ["DeepSearch 联网搜索 + 外部候选库匹配"] + item["reasons"],
        "cautions": item["cautions"] + ["联网候选参数建议以官方实时信息核验"],
        "highlights": "来自 Web Search 和外部候选库",
        "weaknesses": "非本地结构化主库车型",
        "source_type": "web",
        "source_url": source.get("url", ""),
        "source_title": source.get("title", ""),
    }    # 将外部车型转化为卡片格式


def extract_web_vehicle_candidates(web_sources: List[Dict], existing: List[Dict], query: str = "", limit: int = 4) -> List[Dict]:
    # 接收参数 联网搜索结果列表 本地已有的推荐车型 用户原始查询 返回候选数量上限
    existing_names = {f"{item['brand']} {item['model']}".lower().replace(" ", "") for item in existing}   # 本地已有的车型
    query_text = (query + " " + " ".join([src.get("title", "") + " " + src.get("content", "") for src in web_sources])).lower()
    # 将用户查询 和联网搜索标题拼接
    patterns = [
        r"(BMW|宝马)\s*([A-Za-z0-9系]+)",
        r"(Mercedes|奔驰)\s*([A-Za-z0-9级]+)",
        r"(Porsche|保时捷)\s*([A-Za-z0-9]+)",
        r"(Tesla|特斯拉)\s*(Model\s*[A-Za-z0-9]+)",
        r"(Polestar|极星)\s*([A-Za-z0-9]+)",
        r"(MG|名爵)\s*([A-Za-z0-9]+)",
        r"(蔚来|小米|阿维塔|智界|享界|尊界|问界|极氪|腾势)\s*([A-Za-z0-9]+)",
    ]
    candidates = []    # 存储提取到的候选车型
    seen = set()   # 建立去重集合
    generic_keywords = {"跑车", "年轻", "社交", "撩妹", "性能", "豪华", "操控", "敞篷", "纯电跑车", "六座"}    #选车关键词
    source = web_sources[0] if web_sources else {}    # 搜索来源

    for item in EXTERNAL_VEHICLE_CATALOG:
        exact_hit = any(
            keyword not in generic_keywords and keyword.lower().replace(" ", "") in query_text.replace(" ", "")
            for keyword in item["keywords"]    # 检查车型关键词是否在查询文本中
        )
        if exact_hit:    # 精确搜索
            key = f"{item['brand']}{item['model']}".lower().replace(" ", "")
            if key in seen:
                continue
            seen.add(key)
            candidates.append(external_candidate_to_card(item, source))    # 如果没在去重集合中 那就加入候选列表
            if len(candidates) >= limit:
                return candidates

    for item in EXTERNAL_VEHICLE_CATALOG:
        broad_scene_hit = any(word in query_text for word in ["sports car", "跑车", "豪华", "young", "年轻", "attractive", "社交"])
        is_sports_candidate = item.get("model") in {"718 Cayman", "M2", "CLE 53", "Cyberster", "Emira"}  # 通过场景关键词设置候选列表
        if broad_scene_hit and is_sports_candidate:
            key = f"{item['brand']}{item['model']}".lower().replace(" ", "")
            if key in seen or key in existing_names:
                continue
            seen.add(key)
            candidates.append(external_candidate_to_card(item, source))
            if len(candidates) >= limit:
                return candidates
    for src in web_sources:    # 遍历搜索来源
        title = src.get("title") or src.get("content") or ""  # 获取标题、内容
        for pattern in patterns:    # 遍历正则列表
            for brand, model in re.findall(pattern, title, flags=re.IGNORECASE):   # 正则提取品牌 车型
                brand = brand.strip()
                model = model.strip().replace(" ", "")
                if len(model) < 1:
                    continue
                key = f"{brand}{model}".lower().replace(" ", "")
                if key in seen or key in existing_names:    # 去重
                    continue
                seen.add(key)
                candidates.append({
                    "id": -1000 - len(candidates),
                    "brand": brand,
                    "model": model,
                    "vehicle_type": "外部候选",
                    "energy_type": "待核验",
                    "price_min": 0,
                    "price_max": 0,
                    "cltc_range": 0,
                    "seats": 0,
                    "score": 78.0,
                    "budget_score": 0.0,
                    "range_score": 0.0,
                    "space_score": 0.0,
                    "charging_score": 0.0,
                    "smart_score": 0.0,
                    "safety_score": 0.0,
                    "scenario_score": 78.0,
                    "reasons": ["DeepSearch 联网搜索发现的外部候选车型", "参数、价格和配置需要进入详情页或官方渠道核验"],
                    "cautions": ["联网候选未进入本地结构化车型库，建议核验官方价格、配置和交付信息"],
                    "highlights": "来自 Web Search 的候选结果",
                    "weaknesses": "缺少本地结构化参数",
                    "source_type": "web",
                    "source_url": src.get("url", ""),
                    "source_title": title,
                })    # 联网搜索的评分
                if len(candidates) >= limit:
                    return candidates
    if not candidates:
        for src in web_sources[:limit]:
            title = (src.get("title") or src.get("content") or "联网搜索候选").strip()
            short_title = title[:22] + ("..." if len(title) > 22 else "")
            candidates.append({
                "id": -1000 - len(candidates),
                "brand": "联网候选",
                "model": short_title,
                "vehicle_type": "Web Search",
                "energy_type": "待核验",
                "price_min": 0,
                "price_max": 0,
                "cltc_range": 0,
                "seats": 0,
                "score": 76.0,
                "budget_score": 0.0,
                "range_score": 0.0,
                "space_score": 0.0,
                "charging_score": 0.0,
                "smart_score": 0.0,
                "safety_score": 0.0,
                "scenario_score": 76.0,
                "reasons": ["DeepSearch 联网搜索发现的外部候选资料", "标题中可能包含车型、榜单或竞品建议，建议点击来源进一步核验"],
                "cautions": ["该卡片来自网页搜索结果，不等同于本地结构化车型库"],
                "highlights": "来自 Web Search 的候选资料",
                "weaknesses": "缺少本地结构化参数",
                "source_type": "web",
                "source_url": src.get("url", ""),
                "source_title": title,
            })
    return candidates


def social_luxury_candidates(web_sources: List[Dict], existing: List[Dict], profile: Dict, query: str, limit: int = 5) -> List[Dict]:
    candidates = extract_web_vehicle_candidates(web_sources, existing, query, limit=12)
    if not candidates:    # 如果联网搜索没有找到合适车型
        source = web_sources[0] if web_sources else {}  # 获取第一个搜索结果作为来源
        for item in EXTERNAL_VEHICLE_CATALOG:  # 在外部车型目录中只筛选下面的车型
            if item["model"] in {"718 Cayman", "M2", "CLE 53", "Cyberster", "Emira", "Model 3", "E300L", "5系"}:
                candidates.append(external_candidate_to_card(item, source))
    return filter_external_candidates(candidates, profile)[:limit]  # 再次过滤candidates 默认截取前五个


class MultiAgentOrchestrator:
    def route(self, query: str) -> Dict:  # 定义路由方法
        if any(word in query for word in ["对比", "相比", "怎么选", "差异"]):    # 检查用户输入中是否有关键词
            intent = "compare"    # 设置意图为对比
        elif any(word in query for word in ["话术", "客户", "销售", "异议"]):    #
            intent = "sales"      # 设置意图为 销售
        elif any(word in query for word in ["推荐", "买", "预算", "家用", "通勤"]):
            intent = "recommend"    # 意图为 推荐
        else:
            intent = "knowledge"    # 前面都不满足 设置意图为知识
        return {"agent": "RouterAgent", "intent": intent, "observation": f"识别意图为 {intent}"}  # 返回路由结果 agent名称 销售意图

    def generate_answer(self, query: str, profile: Dict, recommendations: List[Dict], sources: List[Dict], sales_script: Dict) -> str:
        top_lines = []    # 空列表储存文本
        for i, item in enumerate(recommendations[:5], 1):   # 索引recommendations enumerate索引函数
            if item.get("source_type") == "web":  #如果车型的来源类型是联网搜索
                top_lines.append(
                    f"{i}. {item['brand']} {item['model']}：联网候选，来源：{item.get('source_title', '')}。理由：{'；'.join(item['reasons'][:2])}"
                )    # 把 车名 来源 利用加入到空列表top_lines
                continue
            top_lines.append(
                f"{i}. {item['brand']} {item['model']}：推荐分 {item['score']}，价格 {item['price_min']//10000}-{item['price_max']//10000} 万，"
                f"{item['energy_type']}，CLTC {item['cltc_range']} km。理由：{'；'.join(item['reasons'][:3])}"
            )   # 如果不是联网搜索 把其他内容加入到列表
        social_note = ""    # 初始化社交形象 声明变量
        if any(x in profile.get("concerns", []) for x in ["社交形象", "内饰氛围", "品牌"]):   # 如果有任何一个关注点在列表内
            social_note = "你提到的“撩妹”我会按更专业的“社交形象/约会第一印象/个人气质匹配”来分析：车辆能增强外在呈现，但真正的吸引力还取决于谈吐、审美和相处体验。\n\n"  # 建立社交形象
        fallback = f"""结论：根据当前画像，推荐优先关注 {recommendations[0]['brand']} {recommendations[0]['model']}。

用户画像摘要：预算上限 {profile.get('budget_max') or '未明确'}，家庭人数 {profile.get('family_size') or '未明确'}，通勤 {profile.get('commute_km') or '未明确'} km，充电条件 {profile.get('has_home_charger')}，关注点 {profile.get('concerns') or '综合体验'}。

{social_note}Hybrid 检索补充：本次推荐同时参考本地结构化车型库、本地 RAG 知识库和 Web Search 公开资料；卡片来自本地结构化车型库，联网资料用于补充价格、政策、口碑和实时信息判断，最终仍建议以官方实时信息为准。

推荐车型：
{chr(10).join(top_lines)}

销售建议：
- 开场：{sales_script.get('opening')}   
- 推荐：{sales_script.get('recommendation')}
- 异议处理：{sales_script.get('objection')}
- 下一步：{sales_script.get('next_action')}

风险提示：实际价格、权益、续航和辅助驾驶可用范围以官方实时信息和试驾体验为准。"""
        if not OPENAI_API_KEY:
            return fallback

        allowed_models = [f"{item['brand']} {item['model']}" for item in recommendations[:5]]
        client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)
        prompt = f"""你是新能源汽车销售推荐专家。请基于用户画像、本地结构化车型评分、本地 RAG 知识库证据、联网 Web Search 公开资料和销售话术，生成专业、克制、可执行的购车建议。

要求：
1. 先给明确推荐结论。
2. 说明用户画像和关键约束。
3. 输出 Top 车型推荐理由。
4. 车型推荐只能围绕“允许推荐车型列表”中的车型展开；联网搜索资料只能作为补充证据，不能把网页标题或未结构化车型当作推荐卡片。
5. 如果联网资料与本地车型库存在差异，请说明“需以官方实时信息核验”，不要直接覆盖结构化参数。
6. 给出销售跟进话术。
7. 使用 [1][2] 引用证据。
8. 避免绝对化表达，不要夸大辅助驾驶或续航。
9. 如果用户使用“撩妹”等说法，请转化为“社交形象、约会第一印象、个人气质匹配”来专业回答。

用户问题：{query}
用户画像：{profile}
允许推荐车型列表：{allowed_models}
推荐结果：{recommendations[:5]}
销售话术：{sales_script}
知识库证据：
{join_sources(sources)}
"""
        resp = client.chat.completions.create(
            model=CHAT_MODEL,
            temperature=TEMPERATURE,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.choices[0].message.content # 获取第一个内容

    def recommend(self, req: RecommendRequest) -> RecommendResponse:
        skills.reset()   # 重置技能追踪日志
        trace = []    # 初始化agent追踪列表
        route = self.route(req.query)    # 意图路由
        trace.append(route)    # 意图路由添加到agent追踪列表

        profile = skills.extract_profile(req.query, req.profile)    # 提取画像
        scene = detect_recommend_scene(req.query, profile)    # 检测推荐场景
        # 记录agent行踪
        trace.append({"agent": "ProfileAgent", "observation": "完成用户画像抽取", "profile": profile})    # 完成画像抽取
        trace.append({"agent": "SceneAgent", "observation": f"识别推荐场景为 {scene}"})    # 识别场景

        skills.vehicle_recall(profile)    # 返回候选车型
        ranked = skills.vehicle_rank(req.query, UserProfile(**profile), req.top_k)    # 车型评分排序
        recommendations = ranked["recommendations"]    #
        trace.append({"agent": "RecommenderAgent", "observation": f"输出 Top {len(recommendations)} 推荐车型"})  # agent追踪列表

        sources = skills.rag_retrieve(req.query, 6)
        web_sources = skills.web_search(build_web_search_query(req.query, scene), 6) if req.use_deep_search else []
        sources = web_sources + sources    # 联合搜索
        if req.use_deep_search and web_sources:
            if scene == "social_luxury":
                web_candidates = social_luxury_candidates(web_sources, recommendations, profile, req.query, max(req.top_k, 5))
                if web_candidates:
                    recommendations = (web_candidates + recommendations)[:max(req.top_k, 5)]
                    trace.append({
                        "agent": "DeepSearchAgent",
                        "observation": f"联网搜索返回 {len(web_sources)} 条公开资料，并整理出 {len(web_candidates)} 个豪华/跑车候选卡片",
                    })    #
                else:
                    trace.append({
                        "agent": "DeepSearchAgent",
                        "observation": f"联网搜索返回 {len(web_sources)} 条公开资料，未找到可结构化的豪华/跑车候选",
                    })    # 寻找豪华场景候选提取
            else:
                trace.append({
                    "agent": "DeepSearchAgent",
                    "observation": f"联网搜索返回 {len(web_sources)} 条公开资料，作为模型综合推荐证据，不直接覆盖结构化车型卡片",
                })
        trace.append({"agent": "ResearchAgent", "observation": f"检索知识证据 {len(sources)} 条，其中联网结果 {len(web_sources)} 条"})

        if recommendations:
            skills.range_estimate(recommendations[0], profile)
            skills.budget_analysis(recommendations[0], profile)

        sales_script = skills.sales_script(profile, recommendations)
        trace.append({"agent": "SalesAgent", "observation": "生成销售辅助话术"})

        answer = self.generate_answer(req.query, profile, recommendations, sources, sales_script)
        answer = skills.compliance_check(answer)
        trace.append({"agent": "ReflectionAgent", "observation": "完成合规检查和风险表达修正"})

        save_recommendation_log(req.query, profile, recommendations)
        return RecommendResponse(
            profile=profile,
            recommendations=recommendations,
            answer=answer,
            agent_trace=trace,
            skill_trace=skills.trace,
            sources=sources,
        )


orchestrator = MultiAgentOrchestrator()
