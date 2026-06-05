import os
from pathlib import Path

import yaml


PROJECT_DIR = Path("d:/ppt1/agent项目2/NEV_Insight_新能源汽车智能推荐平台")
BASE_DIR = PROJECT_DIR / "backend"
DATA_DIR = PROJECT_DIR / "data"
STORAGE_DIR = Path("c:/users/lucha/appdata/local/temp/nev_insight_storage")
CONFIG_DIR = BASE_DIR / "config"
DB_PATH = STORAGE_DIR / "nev_advisor.db"
VECTOR_DIR = STORAGE_DIR / "vector_store"
KNOWLEDGE_DIR = DATA_DIR / "knowledge_base"
VEHICLE_CSV = DATA_DIR / "vehicles" / "vehicle_database.csv"

STORAGE_DIR.mkdir(parents=True, exist_ok=True)
VECTOR_DIR.mkdir(parents=True, exist_ok=True)


def load_yaml():
    path = CONFIG_DIR / "config.yaml"
    if not path.exists():
        path = CONFIG_DIR / "config.example.yaml"
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


SETTINGS = load_yaml()
LLM = SETTINGS.get("llm", {})
OPENAI_API_KEY = LLM.get("api_key", "") or (os.environ.get("DASHSCOPE_API_KEY") if os.environ.get("DASHSCOPE_API_KEY") else "")
OPENAI_BASE_URL = LLM.get("base_url", "https://www.dmxapi.cn/v1")
CHAT_MODEL = LLM.get("chat_model", "gpt-5-mini")
EMBEDDING_MODEL = LLM.get("embedding_model", "")
TEMPERATURE = float(LLM.get("temperature", 0.2))
TIMEOUT = int(LLM.get("timeout", 60))

APP = SETTINGS.get("app", {})
WATERMARK = APP.get("watermark", "章鱼")
