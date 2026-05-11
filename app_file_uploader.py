"""
基于Streamlit网页上传服务
streamlit : 当WEB页面元素发生变化，则代码重新执行一遍2
"""

import streamlit as st    # 开发网页
import dotenv
from langchain_openai import ChatOpenAI
import os
dotenv.load_dotenv()
import time
from streamlit.elements.widgets import file_uploader
from knowledge_base import KnowledgeBaseService
api_key = os.getenv("OPENAI_API_KEY", "")
base_url = os.getenv("OPENAI_BASE_URL", "")

if api_key:
    os.environ["OPENAI_API_KEY"] = api_key
if base_url:
    os.environ["OPENAI_BASE_URL"] = base_url
model = ChatOpenAI(model_name="deepseek-v4-flash",)

st.title("章鱼知识库更新服务")

# st.file_uploader  文件上传
uploader_file = st.file_uploader(
    "请上传TXT文件",
    type=['TXT'],
    accept_multiple_files=False,     # 是否接受多文件上传或者仅一个文件
)
service = KnowledgeBaseService()

# session_state 是一个字典
if "service" not in st.session_state:
    st.session_state["service"] = KnowledgeBaseService()
if uploader_file is not None:
    # 提取文件信息

    file_name = uploader_file.name
    file_type = uploader_file.type
    file_size = uploader_file.size / 1024    # KB

    st.subheader(f'文件名:{file_name}')    # 二级标题
    st.write(f'格式:{file_name}|大小:{file_size:.2f} KB')    # 显示文字
    # get_value 获取 文件内容
    text = uploader_file.getvalue().decode('utf8')

    with st.spinner("载入知识库中。。。"):       # 在spinner内的代码执行过程中，会有一个转圈动画
        time.sleep(1)
        result = st.session_state["service"].uploader_by_str(text, file_name)
        st.write(result)
