from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List

from sklearn.feature_extraction.text import HashingVectorizer, TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from app.config import KNOWLEDGE_DIR


@dataclass
class Chunk:    # 每个 Chunk 代表一个知识片段，用于存储向量化前的原始信息。
    source: str
    domain: str
    content: str


class HybridRAG:
    def __init__(self):
        self.chunks: List[Chunk] = []    # 存储所有知识片段
        self.vectorizer = TfidfVectorizer(token_pattern=r"(?u)\b\w+\b", ngram_range=(1, 2))    # 向量化器 分词模式：匹配单词边界 支持单字和双字
        self.fallback_vectorizer = HashingVectorizer(n_features=4096, alternate_sign=False, token_pattern=r"(?u)\b\w+\b")
        self.matrix = None
        self.use_tfidf = True
        self.rebuild()

    def split_text(self, text: str, size: int = 520, overlap: int = 80) -> List[str]:    # 文本切割
        clean = "\n".join(line.strip() for line in text.splitlines() if line.strip())
        chunks = []
        start = 0
        while start < len(clean):
            chunks.append(clean[start:start + size])
            start += size - overlap
        return chunks

    def domain_from_name(self, path: Path) -> str:    # 领域分类
        name = path.stem    # 根据文件名分类领域
        if "选购" in name:
            return "选购指南"
        if "技术" in name or "纯电" in name:
            return "能源路线"
        if "电池" in name:
            return "电池安全"
        if "充电" in name or "续航" in name:
            return "补能续航"
        if "智能" in name:
            return "智能化"
        if "家庭" in name:
            return "家庭场景"
        if "话术" in name:
            return "销售话术"
        if "竞品" in name:
            return "竞品对比"
        if "合规" in name:
            return "合规规范"
        return "通用知识"

    def rebuild(self):    # 重建索引
        self.chunks = []
        for path in sorted(KNOWLEDGE_DIR.glob("*.md")):
            text = path.read_text(encoding="utf-8")
            for chunk in self.split_text(text):    # 索引knowledge文本内容
                self.chunks.append(Chunk(path.name, self.domain_from_name(path), chunk))    # 将文本名称 分类 和内容存到chunks
        docs = [chunk.content for chunk in self.chunks]    # 将内容存到docs列表
        if docs:
            try:
                self.matrix = self.vectorizer.fit_transform(docs)   # 将内容向量化
                self.use_tfidf = True
            except ValueError:
                self.matrix = self.fallback_vectorizer.transform(docs) #如果失败就使用HashingVectorizer.transform
                self.use_tfidf = False

    def bm25_like(self, query: str, text: str) -> float:
        q_terms = [x for x in query.lower().replace("，", " ").replace("。", " ").split() if x]  # 逗号句号替换为空格 按空格切分得到词项列表
        if not q_terms:
            q_terms = [query[i:i + 2] for i in range(max(len(query) - 1, 0))]   # 如果结果为空 将查询切为2‑gram字符
        if not q_terms:
            return 0
        lower = text.lower()   # 把传入的文本转小写
        hits = sum(1 for term in q_terms if term and term in lower)    # 计算有多少个词项出现在文本
        return min(hits / max(len(q_terms), 1), 1)    #

    def retrieve(self, query: str, top_k: int = 6) -> List[Dict]:
        if not self.chunks:    #如果没有文档内容 返回空列表
            return []
        if self.use_tfidf:
            qv = self.vectorizer.transform([query])    # 查询向量化
        else:
            qv = self.fallback_vectorizer.transform([query])    # 计算余弦相似度sims
        sims = cosine_similarity(qv, self.matrix).flatten()
        rows = []
        for idx, chunk in enumerate(self.chunks):
            bm25 = self.bm25_like(query, chunk.content)    # 计算有多少个词命中文本
            score = float(sims[idx]) * 0.68 + bm25 * 0.32    # 计算混合得分
            rows.append({
                "rank": idx + 1,
                "source": chunk.source,
                "domain": chunk.domain,
                "content": chunk.content,
                "vector_score": round(float(sims[idx]), 4),
                "bm25_score": round(bm25, 4),
                "score": round(score, 4),
            })
        rows.sort(key=lambda x: x["score"], reverse=True)    # 按得分排序
        return [{**row, "rank": i + 1} for i, row in enumerate(rows[:top_k])]   #编号

    def stats(self):
        domains = {}
        for chunk in self.chunks:
            domains[chunk.domain] = domains.get(chunk.domain, 0) + 1
        return {"chunks": len(self.chunks), "documents": len(list(KNOWLEDGE_DIR.glob("*.md"))), "domains": domains}


rag_service = HybridRAG()
