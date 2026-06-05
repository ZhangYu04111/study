from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import CHAT_MODEL, OPENAI_API_KEY, OPENAI_BASE_URL, WATERMARK
from app.database import clear_runtime_data, create_lead, init_db, list_leads, list_vehicles
from app.schemas import ChatRequest, CompareRequest, DeepSearchRequest, LeadCreate, RecommendRequest
from app.services.agent_orchestrator import orchestrator
from app.services.analytics import dashboard_summary
from app.services.deep_search import deep_search_engine
from app.services.customer_service import customer_service_agent
from app.services.rag import rag_service
from app.services.skills import skills


app = FastAPI(title="NEV Insight 新能源汽车智能推荐平台", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    init_db()        # 启动时调用数据库，


@app.get("/api/dashboard/summary")
def get_dashboard():
    return dashboard_summary()


@app.get("/api/vehicles")
def get_vehicles():
    return {"vehicles": list_vehicles()}


@app.post("/api/recommend")
def recommend(req: RecommendRequest):
    return orchestrator.recommend(req)


@app.post("/api/compare")
def compare(req: CompareRequest):
    skills.reset()
    result = skills.compare_vehicle(req.models, req.profile)
    return {"result": result, "skill_trace": skills.trace}


@app.post("/api/rag/chat")
def rag_chat(req: ChatRequest):
    sources = rag_service.retrieve(req.query, req.top_k)
    answer = "根据知识库检索结果，建议从使用场景、预算、补能条件和安全配置四个维度综合判断。\n\n"
    for i, src in enumerate(sources[:4], 1):
        answer += f"{i}. {src['content'][:160]}... [{i}]\n"
    answer += "\n风险提示：价格、权益、质保和辅助驾驶范围以官方实时说明为准。"
    return {"answer": answer, "sources": sources}


@app.post("/api/customer-service/chat")
def customer_service_chat(req: ChatRequest):
    return customer_service_agent.answer(req)


@app.post("/api/deep-search")
def deep_search(req: DeepSearchRequest):
    return deep_search_engine.run(req)


@app.post("/api/leads")
def add_lead(req: LeadCreate):
    return create_lead(req.model_dump())


@app.get("/api/leads")
def get_leads():
    return {"leads": list_leads()}


@app.post("/api/rag/rebuild")
def rebuild_rag():
    rag_service.rebuild()
    return rag_service.stats()


@app.get("/api/config/public")
def public_config():
    return {
        "base_url": OPENAI_BASE_URL,
        "chat_model": CHAT_MODEL,
        "api_key_configured": bool(OPENAI_API_KEY),
        "watermark": WATERMARK,
    }


@app.post("/api/admin/clear-runtime-data")
def clear_data():
    return {"result": clear_runtime_data(), "summary": dashboard_summary()}

# 异常处理
