from gitdb.fun import chunk_size
from langchain_classic import embeddings
from zipp.glob import separate

md5_path = "./md5.text"


# Chroma
collection_name = "rag"
persist_directory = "./chroma_db"

#spliter
chunk_size = 1000
chunk_overlap = 100
max_split_char_number = 10
separators = ['\n\n','\n','.','。','?','？',',','，',';','']

#
similarity_threshold = 2    # 检索返回匹配的文档数量

embeddings_model_name = "text-embedding-3-small"

chat_model_name = "deepseek-v4-flash"
chat_model_temperature = 0.1  # 降低温度加快响应
chat_model_max_tokens = 512   # 限制输出长度
chat_model_timeout = 30       # 设置超时时间

session_config = {
    "configurable":{
        "session_id":"user_001"
    }
}