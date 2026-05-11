from langchain_core.output_parsers.string import StrOutputParser
from langchain_core.runnables import RunnableLambda
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain_core.runnables.passthrough import RunnablePassthrough
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from file_history_store import get_history
from langchain_core.documents import Document
from vectot_stores import VectorStoreService
import config_data as config
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

def print_prompt(prompt):
    print("="*20)
    print(prompt.to_string())
    print("="*20)

    return prompt

class RagService(object):
    def __init__(self):
        self.vector_service = VectorStoreService(
            embedding=OpenAIEmbeddings(model=config.embeddings_model_name)
        )

        self.prompt_template = ChatPromptTemplate.from_messages(
            [
                ("system", "以我提供的已知参考资料为主，"
                 "简洁专业的回答用户问题。参考资料：{context}"),
                ("system", "并且我提供用户对话的历史记录，如下："),
                MessagesPlaceholder("history"),
                ("user", "请回答用户提问:{input}")
            ]
        )
        self.chat_model = ChatOpenAI(
            model=config.chat_model_name,
            temperature=config.chat_model_temperature,
            max_tokens=config.chat_model_max_tokens,
            timeout=config.chat_model_timeout,
        )

        self.chain = self.get_chain()

    def get_chain(self):
        retriever = self.vector_service.get_retriever()

        def format_document(docs: list[Document]):
            if not docs:
                return "无相关参考资料"
            formatted_str = ""
            for doc in docs:
                formatted_str += f"文档片段{doc.page_content}\n文档元数据:{doc.metadata}\n\n"
            return formatted_str

        def format_retriever(value: dict):
            print("--------", value)
            return value["input"]

        def format_prompt_template(value: dict):
            new_value = {}
            new_value["input"] = value["input"]["input"]
            new_value["context"] = value["context"]
            new_value["history"] = value["input"]["history"]
            return new_value

        chain = (
            {
                "input": RunnablePassthrough(),
                "context": RunnableLambda(format_retriever) | retriever | format_document
            } | RunnableLambda(format_prompt_template) | self.prompt_template | print_prompt | self.chat_model | StrOutputParser()
        )
        conversation_chain = RunnableWithMessageHistory(
            chain,
            get_history,
            input_messages_key="input",
            history_messages_key="history",
        )
        return conversation_chain

if __name__ == "__main__":
    RagService().chain.invoke({"input": "测试", "history": []})