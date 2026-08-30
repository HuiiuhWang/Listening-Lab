# Listening Lab

一个在 Mac（优先 Apple Silicon）上完全本地运行的英语逐句精听 Web App。界面使用英文；媒体、转写结果、听写和学习进度都保存在本机，不使用付费 API 或远端服务器。

## 已实现

- 导入 `mp3`、`wav`、`m4a`、`mp4`、`mov`
- FFmpeg 提取 16 kHz 单声道 PCM 音频
- MLX Whisper 本地英文转写与 word-level timestamps
- 按标点、停顿、时长和词数自动断句
- 自动优先使用媒体内嵌的英文官方字幕，也可手动导入 `SRT/VTT`；没有官方字幕时使用 Whisper transcript
- 逐句播放、前后句、完整 transcript，以及可手动调整句子时间边界
- 从真实 PCM 采样绘制的交互 waveform：单击跳转、拖动选区、拖动左右边界、A–B 循环、取消选区
- 0.5× 至 1.25× 调速；浏览器原生变速会尽量保持音调，选区慢放和循环同样生效
- 听写、word-level diff（漏词、错词、多余词）、显示/隐藏答案
- 单击 transcript 单词跳转；Shift-click 第二个词可选择连续词并建立对应音频选区
- Space、←/→、R、+/− 快捷键
- 可设置整句连续播放次数（2–50 遍），达到次数后自动停在句尾；与 A–B 无限循环分开控制
- `Practice Sources` 在线发现面板：读取 BBC、VOA、NPR 官方节目/RSS，并提供 TED 官方素材入口
- SQLite 自动保存素材处理结果、听写、diff 错误记录、当前句、播放位置和速度
- 自定义材料文件夹（不预设固定分类）、文件夹重命名、文件夹间拖放材料、指定导入目标、完成标记，以及材料/文件夹删除

每个材料只保留一个原始媒体文件和一个完整的提取音轨，不会按句切割或生成大量音频文件。句子只由数据库中的 `start` / `end` 时间戳表示。Transcript 文本为只读参考；每句的开始、结束边界可以手动调整。

删除文件夹时界面会提供两种选择：仅删除文件夹并把材料移回 `Unfiled`，或者永久删除文件夹及其中全部材料。永久删除会同时移除媒体、transcript、听写与学习记录。

## 环境要求

- macOS，推荐 M1/M2/M3/M4
- [Homebrew](https://brew.sh/)
- Python 3.10+（推荐 3.12）
- Node.js 20+
- FFmpeg

安装系统依赖：

```bash
brew install python@3.12 node ffmpeg
```

## 安装与启动

```bash
chmod +x setup.sh start.sh
./setup.sh
./start.sh
```

浏览器打开 <http://127.0.0.1:5173>。

首次转写时，MLX Whisper 会从 Hugging Face 下载免费模型，之后从本机缓存运行。默认模型为 `mlx-community/whisper-small-mlx`。可在启动前切换模型：

```bash
WHISPER_MODEL=mlx-community/whisper-medium-mlx ./start.sh
```

`small` 速度和准确率比较均衡；更大的模型更准，但下载、内存占用和转写时间都会增加。

## 数据位置

- 数据库：`backend/data/listening.sqlite3`
- 原始媒体与提取音频：`backend/data/materials/<material-id>/`

这些文件已加入 `.gitignore`。备份 `backend/data` 即可备份学习记录。也可通过 `LISTENING_DATA_DIR` 改变数据目录。

## 手动开发

后端：

```bash
source .venv/bin/activate
uvicorn app.main:app --app-dir backend --reload
```

前端：

```bash
npm --prefix frontend run dev
```

测试与构建：

```bash
.venv/bin/pip install -r backend/requirements-dev.txt
PYTHONPATH=backend .venv/bin/pytest backend/tests
npm --prefix frontend run build
```

## 实现说明

后端上传后异步执行 FFmpeg 和 MLX Whisper。前端轮询处理状态；准备完成后加载逐词和逐句时间戳。Waveform 不是图片：后端直接读取 FFmpeg 生成的 16-bit PCM 采样并按当前句降采样为 min/max 峰值，前端用 SVG 实时绘制并处理指针交互。播放使用同一完整音轨上的绝对时间，因此手动句界、单词跳转与 A–B 选区使用同一时间轴。

当前为单机单用户 MVP。不要将 FastAPI 端口暴露到公网；上传接口没有登录鉴权。

`Practice Sources` 仅在打开素材发现面板时访问公开官方页面/RSS，并缓存 15 分钟；不使用付费 API，也不会把媒体上传到任何服务。外部素材的使用与下载应遵守对应提供方条款。
