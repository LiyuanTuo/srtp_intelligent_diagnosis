# Render 部署与模型就绪排查

网页和语音分析由同一个 FastAPI 服务提供。`/api/health` 中的 `model_ready` 必须为 `true`，网页能打开本身不能证明模型可用。`/api/ready` 只有在模型和 FFmpeg 都就绪时返回 HTTP 200。

## 修复现有 Render 服务

1. 将包含本文件、`Dockerfile` 和模型依赖修复的提交部署到现有 Web Service。服务的 **Settings → Build → Source → Edit** 可更换 Git 仓库、分支和 Runtime。选择 **Docker**，使用仓库根目录的 `Dockerfile`；不要新建服务，这样可保留原有 `onrender.com` 地址。
2. 确认实例至少有 **2 GB 内存**，实例数为 1。PyTorch、openSMILE 和 VGGish 常驻内存超过 Render 免费实例的 512 MB。一个 Uvicorn worker 只加载一份模型。
3. 在 **Settings → Health Checks** 将 HTTP 路径设为 `/api/ready`。不要用只表示网页进程存活的 `/` 作为模型就绪检查。
4. 手动触发部署并查看构建日志。Docker 构建会安装 CPU PyTorch、固定兼容的 `pyarrow` 版本，并下载及校验约 289 MB 的 VGGish 权重。若下载失败，构建会直接失败；不要跳过校验或把大文件提交到 Git。
5. 查看运行日志，确认无 `Model initialization failed:`；打开 `https://<现有服务>.onrender.com/api/health`，确认 `status=ready`、`model_ready=true`、`decoder_ready=true`。最后使用有授权的非敏感测试录音提交一次，确认真实模型返回结果。

如果保留 Render **Python** Runtime，仓库根目录的 `.python-version` 会选 Python 3.12；还必须把 Build Command 改为：

```sh
python -m pip install torch==2.3.1 --index-url https://download.pytorch.org/whl/cpu && python -m pip install -r requirements.txt && python scripts/download_vggish.py
```

Start Command：

```sh
python -m uvicorn backend.app:app --host 0.0.0.0 --port $PORT --workers 1 --no-access-log
```

务必在构建阶段下载权重；Render 运行时的文件系统是临时的，仅在本地下载过的文件不会出现在云端。当前实现启动时不联网下载模型，以避免每次重启依赖外网。

## 故障定位

- `/api/health` 为 `model_ready=false`：查看 Render **Logs** 中 `Model initialization failed:` 后面的原始异常。常见情况是缺少 `models/vggish-10086976.pth`，或依赖版本不兼容。
- 构建日志显示 `scripts/download_vggish.py` 下载失败：检查上游下载连接和 SHA-256，不要绕过哈希校验。
- 进程被系统杀死或反复重启：检查 Render 内存指标和实例规格。免费实例不够运行该模型。
- `/api/ready` 返回 404：当前服务运行的还是旧代码，须部署包含就绪接口的新提交。

服务公开后，任何人都可提交音频；本项目没有账号或访问控制。演示结束后须在 Render Dashboard **删除 Web Service** 才能停止其计算资源费用，维护模式不会停止计费。

参考：[Render 更改 Runtime](https://render.com/docs/native-runtimes)、[HTTP 健康检查](https://render.com/docs/health-checks)、[Python 版本](https://render.com/docs/python-version)。
