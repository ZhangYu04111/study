import html
import re
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from typing import Dict, List

from app.database import find_vehicles_by_models, list_vehicles, match_mentioned_vehicles
from app.schemas import UserProfile
from app.services.rag import rag_service
from app.services.recommender import normalize_profile, recommend, score_vehicle


class SkillRegistry:
    def __init__(self):
        self.trace: List[Dict] = []    # 初始化 创建一个追踪列表日志

    def reset(self):
        self.trace = []    # 清空日志 用于新的推荐对话

    def record(self, name: str, observation: str, payload=None):    # 记录skill的调用 名称 结果描述 附加数据
        self.trace.append({"skill": name, "observation": observation, "payload": payload})

    def extract_profile(self, query: str, profile: UserProfile) -> Dict:    # 提取用户画像
        result = normalize_profile(query, profile)    # 引用recommender 补全后的用户画像
        self.record("extract_profile_skill", "完成自然语言购车画像抽取", result)    # 调用上面record将日志记录到trace
        return result

    def vehicle_recall(self, profile: Dict) -> List[Dict]:
        vehicles = list_vehicles()
        mentioned = profile.get("mentioned_models") or []
        if mentioned:
            rows = [v for v in vehicles if f"{v['brand']} {v['model']}" in mentioned]
            self.record("vehicle_recall_skill", f"用户点名车型优先召回 {len(rows)} 款", {"models": mentioned})
            return rows    # 记录日志 记录下用户提到的车型
        budget_max = profile.get("budget_max")
        preferred_type = profile.get("preferred_type")
        preferred_energy = profile.get("preferred_energy")
        rows = []
        for vehicle in vehicles:    # 如果没有明确提到车型 那就再次筛选
            if budget_max and vehicle["price_min"] > budget_max * 1.25:
                continue
            if preferred_type and preferred_type not in vehicle["vehicle_type"]:
                continue
            if preferred_energy and preferred_energy != vehicle["energy_type"]:
                continue
            rows.append(vehicle)
        if not rows:    # 如果没有筛选到那就 返回所有车型
            rows = vehicles
        self.record("vehicle_recall_skill", f"召回候选车型 {len(rows)} 款", {"count": len(rows)})
        return rows    # 记录日志 返回用户偏爱的车型

    def vehicle_rank(self, query: str, profile: UserProfile, top_k: int = 5) -> Dict:
        result = recommend(query, profile, top_k)    # 调用recommender内函数 返回排名前五的推荐车
        self.record("vehicle_rank_skill", f"完成车型评分排序，输出 Top {len(result['recommendations'])}", result["recommendations"])
        return result    # 记录日志

    def range_estimate(self, vehicle: Dict, profile: Dict) -> Dict:
        cltc = vehicle["cltc_range"]
        factor = 0.85
        if profile.get("long_trip_frequency") in {"经常", "高"}:
            factor = 0.72
        if "冬季" in profile.get("city", ""):
            factor = min(factor, 0.72)
        estimate = int(cltc * factor)
        result = {"model": vehicle["model"], "cltc_range": cltc, "estimated_real_range": estimate, "factor": factor}
        self.record("range_estimate_skill", f"{vehicle['model']} 估算实际续航 {estimate} km", result)
        return result    # 估算续航 记录日志  续航乘以不同条件下的续航折扣

    def budget_analysis(self, vehicle: Dict, profile: Dict) -> Dict:
        price = int((vehicle["price_min"] + vehicle["price_max"]) / 2)
        down_payment = int(price * 0.3)
        loan = price - down_payment
        monthly = int(loan / 36)
        energy_cost_year = 2600 if vehicle["energy_type"] == "纯电" else 5200
        result = {
            "model": vehicle["model"],
            "estimated_price": price,
            "down_payment_30_percent": down_payment,
            "monthly_36": monthly,
            "estimated_energy_cost_year": energy_cost_year,
        }
        self.record("budget_analysis_skill", f"{vehicle['model']} 完成预算测算", result)
        return result    # 记录日志 返回预算的估计 首付 分期等信息

    def compare_vehicle(self, models: List[str], profile: UserProfile) -> Dict:
        vehicles = find_vehicles_by_models(models)
        if not vehicles:
            vehicles = match_mentioned_vehicles(" ".join(models))
        profile_dict = profile.model_dump()
        scored = [score_vehicle(vehicle, profile_dict) for vehicle in vehicles]
        self.record("compare_vehicle_skill", f"完成 {len(scored)} 款车型对比", scored)
        return {"vehicles": scored}  # 车型对比

    def rag_retrieve(self, query: str, top_k: int = 6) -> List[Dict]:
        sources = rag_service.retrieve(query, top_k)
        self.record("rag_retrieve_skill", f"召回知识库证据 {len(sources)} 条", sources)
        return sources    # 返回检索结果 从知识库检索

    def web_search(self, query: str, top_k: int = 5) -> List[Dict]:
        def parse_links(page: str) -> List[Dict]:    # 一个嵌套函数，负责从 HTML 页面源码中提取搜索结果链接和标题。
            rows = []
            patterns = [
                r'<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
                r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
            ]    # 匹配结果链接
            for pattern in patterns:
                for href, title in re.findall(pattern, page, flags=re.I | re.S):
                    clean_title = re.sub(r"<.*?>", "", title)    # 移除 <tag> 等标签，得到纯文本。
                    clean_title = html.unescape(clean_title).strip()    # html.unescape 将 &amp; 转为 &，&quot; 转为 " 等。反转义
                    clean_href = html.unescape(href).strip()    # 去除首尾空白
                    if not clean_title or len(clean_title) < 5:    # 标题太短跳过
                        continue
                    if any(skip in clean_href for skip in ["javascript:", "#", "/settings", "duckduckgo.com/y.js"]):   # 排除 javascript: 伪链接、锚点、设置页面、跟踪脚本。
                        continue
                    if clean_title.lower() in {"images", "videos", "news", "maps"}:   # 排除导航类标签（如“图片”、“视频”、“新闻”、“地图”）。
                        continue
                    rows.append({
                        "rank": len(rows) + 1,
                        "title": clean_title[:120],  # 限制长度
                        "url": clean_href,    # 清理后的链接
                        "source": "web",      # 来源为web
                        "domain": "联网搜索",   # 标签
                        "content": clean_title[:200],    # 摘要，长度限制后
                        "score": 1.0,   # 固定满分
                    })
                    if len(rows) >= top_k:
                        return rows
                if rows:
                    return rows
            return rows    #返回结果
#    异常处理 给出网站 返回搜索结果
        try:
            urls = [
                "https://duckduckgo.com/html/?" + urllib.parse.urlencode({"q": query}),
                "https://lite.duckduckgo.com/lite/?" + urllib.parse.urlencode({"q": query}),
                "https://www.bing.com/search?" + urllib.parse.urlencode({"q": query}),
            ]    #
            rows = []
            for url in urls:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=8) as resp:
                    page = resp.read().decode("utf-8", errors="ignore")
                rows = parse_links(page)
                if rows:
                    break
            self.record("web_search_skill", f"联网搜索返回 {len(rows)} 条结果", rows)
            return rows
        except Exception as exc:
            self.record("web_search_skill", f"联网搜索失败，已回退本地知识库：{exc}", [])
            return []

    def sales_script(self, profile: Dict, recommendations: List[Dict]) -> Dict:    # 生成销售话术
        top = recommendations[0] if recommendations else {}    # 获取排名第一的车型
        concerns = "、".join(profile.get("concerns", [])) or "预算和综合体验"    # 用户关注点
        model_name = f"{top.get('brand', '')} {top.get('model', '')}".strip()   #最好的车型名称
        script = {
            "opening": f"我先根据您的预算、通勤和关注点做一个匹配分析，重点看{concerns}。",
            "recommendation": f"目前匹配度最高的是 {model_name}，主要原因是它在预算、续航和家庭场景上比较均衡。",
            "objection": "如果您担心续航或电池安全，我们可以结合实际通勤距离、充电条件和官方质保政策一起核算。",
            "next_action": "建议安排一次试驾，并同时确认充电条件和近期官方权益。",
        }
        self.record("sales_script_skill", "生成销售跟进话术", script)
        return script

    def compliance_check(self, text: str) -> str:    # 违规词换成合适表达
        replacements = {
            "绝对安全": "安全配置较完整",
            "自动驾驶": "辅助驾驶",
            "吊打": "在部分维度更有优势",
            "一定省钱": "长期使用成本有机会降低",
            "续航不打折": "实际续航受场景影响",
            "保证最低价": "价格以官方实时政策为准",
        }
        revised = text
        for old, new in replacements.items():
            revised = revised.replace(old, new)  # 将用户原话违规词替换为合规表达
        self.record("compliance_check_skill", "完成合规表达检查", {"changed": revised != text})
        return revised


skills = SkillRegistry()


class DuckDuckGoParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.results: List[Dict] = []
        self._in_link = False
        self._href = ""
        self._text = []

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        class_name = attrs_dict.get("class", "")
        if tag == "a" and "result__a" in class_name:
            self._in_link = True
            self._href = attrs_dict.get("href", "")
            self._text = []

    def handle_data(self, data):
        if self._in_link:
            self._text.append(data.strip())

    def handle_endtag(self, tag):
        if tag == "a" and self._in_link:
            title = "".join(self._text).strip()
            if title:
                self.results.append({
                    "rank": len(self.results) + 1,
                    "title": title,
                    "url": self._href,
                    "source": "web",
                    "domain": "联网搜索",
                    "content": title,
                    "score": 1.0,
                })
            self._in_link = False
