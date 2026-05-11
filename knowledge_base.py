"""
知识库
"""
import os
from importlib.metadata import metadata

from langchain_openai import OpenAIEmbeddings
import config_data as config
import hashlib
from langchain_chroma import Chroma
from langchain_community.embeddings import HuggingFaceBgeEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from datetime import datetime
from langchain_openai import ChatOpenAI
import os
import dotenv
from openai.types import vector_store_search_params

dotenv.load_dotenv()

# 前提：加载配置文件
api_key = os.getenv("OPENAI_API_KEY", "")
base_url = os.getenv("OPENAI_BASE_URL", "")

if api_key:
    os.environ["OPENAI_API_KEY"] = api_key
if base_url:
    os.environ["OPENAI_BASE_URL"] = base_url
model = ChatOpenAI(model_name="deepseek-v4-flash",)

def check_md5(md5_str:str):     # 检查传入的md5字符串是否已经被处理过了
    if not os.path.exists(config.md5_path):
        open(config.md5_path, 'w',encoding="utf_8").close()   # 如果文件不存在 'w' 类型会直接创建文件，close关闭文件
        # if 进入表示文件不存在，那说明没有处理过这个文件
        return False
    else:
        for line in open(config.md5_path, 'r',encoding="utf_8").readlines():
            line = line.strip()    # 处理字符串前后的空格和回车
            if line == md5_str:
                return True
        return False


def save_md5(md5_str:str):      # 将传入的md5字符串传入到文件内保存
    with open(config.md5_path, 'a',encoding="utf_8") as f:    # 'a'代表追加内容
        f.write(md5_str + "\n")

def get_string_md5(input_str:str,encoding="utf_8"):   # 将传入的字符串转化为md5字符串
    # 将字符串转换为bytes字节数组
    str_bytes = input_str.encode(encoding=encoding)
    # 创建md5对象
    md5_obj = hashlib.md5()    # md5对象
    md5_obj.update(str_bytes)     # 更新内容（传入即将转换的字节数组）
    md5_hex = md5_obj.hexdigest()     # 得到md5十六进制字符串
    return md5_hex
class KnowledgeBaseService(object):

    def __init__(self):
        # 如果文件夹不存在则创建，如果存在则跳过
        os.makedirs(config.persist_directory,exist_ok=True)
        self.chroma = Chroma(
            collection_name= config.collection_name,    # 数据库的表名
            embedding_function=OpenAIEmbeddings(model="text-embedding-3-small"),
            persist_directory = config.persist_directory,    # 数据库本地存储文件夹
        )    # 向量存储的实例
        self.spliter = RecursiveCharacterTextSplitter(
            chunk_size=config.chunk_size,    # 分割后文本最大长度
            chunk_overlap=config.chunk_overlap,    # 连续文本段之间的字符串重叠数量
            separators=config.separators,     # 自然段划分的符号
            length_function=len,     # 使用Python自带的len函数做长度统计的依据
        )   # 文本分割器对象
    def uploader_by_str(self,data,filename):
        """ 将传入的字符串向量化，存入到向量数据库中"""
        # 先得到传入字符串md5的值
        md5_hex = get_string_md5(data)
        if check_md5(md5_hex):
            return "[跳过]内容已经存在知识库中"
        if len(data)>config.max_split_char_number:
            knowledge_chunks:list[str] = self.spliter.split_text(data)
        else:
            knowledge_chunks = [data]

        metadata = {
            "source": filename,
            "create_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "operator":"章鱼",
        }

        self.chroma.add_texts(
            # iterable ->list/tuople
            knowledge_chunks,
            metadatas=[metadata for _ in knowledge_chunks],

        )
        save_md5(md5_hex)
        return "[成功]内容成功载入向量库"

