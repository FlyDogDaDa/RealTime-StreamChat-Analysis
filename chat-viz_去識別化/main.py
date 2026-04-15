import asyncio
import numpy as np
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pytchat.core import PytchatCore
from ollama import AsyncClient
from sklearn.cluster import HDBSCAN

app = FastAPI()

# 允許前端連線
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ollama 配置
OLLAMA_URL = "http://[我.的.I.P]:11434"
client = AsyncClient(host=OLLAMA_URL)


class ChatEngine:
    def __init__(self, video_id):
        self.video_id = video_id
        self.chat = PytchatCore(video_id, interruptable=False)
        self.nodes = (
            []
        )  # 儲存格式: {"id": str, "text": str, "count": int, "embedding": list, "cluster": int}
        self.clusterer = HDBSCAN(min_cluster_size=3)

    async def process_loop(self, websocket: WebSocket):
        while self.chat.is_alive():
            data = self.chat.get()
            if not data or not data.items:
                await asyncio.sleep(1)
                continue

            # 建立當前緩衝區的文字查找表
            current_map = {n["text"]: n for n in self.nodes}
            new_items_to_embed = []

            for item in data.items:
                msg_text = item.message
                if msg_text in current_map:
                    # 重複留言：增加計數，不重複計算 Embedding
                    current_map[msg_text]["count"] = (
                        current_map[msg_text].get("count", 0) + 1
                    )
                else:
                    # 全新留言：準備計算 Embedding
                    new_items_to_embed.append(item)
                    # 先佔位防止同批次重複
                    current_map[msg_text] = {"text": msg_text}

            # 批次處理新留言的 Embedding
            if new_items_to_embed:
                try:
                    texts = [m.message for m in new_items_to_embed]
                    resp = await client.embed("BGE-M3:latest", texts)
                    for msg, emb in zip(new_items_to_embed, resp.embeddings):
                        self.nodes.append(
                            {
                                "id": msg.id,
                                "text": msg.message,
                                "author": msg.author.name,
                                "count": 1,
                                "embedding": emb,
                                "cluster": -1,
                            }
                        )
                except Exception as e:
                    print(f"AI Embedding Error: {e}")

            # 保持滑動視窗
            if len(self.nodes) > 300:
                self.nodes = self.nodes[-300:]

            # 執行分群運算
            if len(self.nodes) > 5:
                embeddings_array = np.array([n["embedding"] for n in self.nodes])
                clusters = self.clusterer.fit_predict(embeddings_array)
                for i, c in enumerate(clusters):
                    self.nodes[i]["cluster"] = int(c)

            # 準備傳送給前端 (移除巨大的 embedding 向量以節省頻寬)
            output_nodes = []
            for n in self.nodes:
                node_copy = {k: v for k, v in n.items() if k != "embedding"}
                output_nodes.append(node_copy)

            await websocket.send_json({"nodes": output_nodes})
            await asyncio.sleep(1)


@app.websocket("/ws/{video_id}")
async def websocket_endpoint(websocket: WebSocket, video_id: str):
    await websocket.accept()
    print(f"✅ Client Connected: {video_id}")
    engine = ChatEngine(video_id)
    try:
        await engine.process_loop(websocket)
    except Exception as e:
        import traceback

        traceback.print_exc()
        print(f"❌ Connection Closed: {e}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
