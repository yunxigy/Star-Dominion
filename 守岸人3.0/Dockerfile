FROM python:3.11-slim

WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsm6 \
    libxext6 \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY server/requirements.txt .

# 安装Python依赖
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY . .

# 创建数据目录
RUN mkdir -p data/characters data/chats data/groups data/worlds data/audio_cache data/voices data/characters/avatars

# 暴露端口
EXPOSE 8000

# 启动命令
CMD ["python", "-m", "server.main"]
