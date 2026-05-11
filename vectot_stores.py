import os

from langchain_chroma import Chroma
from langchain_openai import ChatOpenAI, OpenAI

import config_data as config

class VectorStoreService(object):
    def __init__(self, embedding):
        self.embedding = embedding

        self.vector_store = Chroma(
            collection_name=config.collection_name,
            embedding_function=self.embedding,
            persist_directory=config.persist_directory,
        )

    def get_retriever(self):
        """返回向量检索器，方便加入chain"""
        return self.vector_store.as_retriever(search_kwargs={"k": config.similarity_threshold})


api_key = os.getenv("OPENAI_API_KEY", "")
base_url = os.getenv("OPENAI_BASE_URL", "")

if api_key:
    os.environ["OPENAI_API_KEY"] = api_key
if base_url:
    os.environ["OPENAI_BASE_URL"] = base_url
model = OpenAI(model_name="deepseek-v4-flash",)