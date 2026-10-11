# 公开部署（Render）

本项目由同一个 FastAPI 进程提供网页和语音分析接口。GitHub Pages 等纯静态托管无法运行模型。部署文件为根目录的 `Dockerfile` 和 `render.yaml`；容器构建时下载并校验 VGGish 权重，运行时不下载模型。

## 资源与费用

- `render.yaml` 选择 Render `1c-2g`（1 CPU、2 GB 内存）Web Service。Render 当前标价约 **US$25/月**，按运行时间计费；流量等可能另计。创建服务前请在 Render 界面核对实时价格。
- 默认部署到新加坡地区。若连续运行 10 或 15 天，按 US$25/月粗估计算费用约为 **US$8–13**；实际账单随当月天数、启动时间和额外用量变化。
- 免费实例只有 512 MB 内存，不适合本项目的 PyTorch、openSMILE 和模型常驻内存需求。
- 一个进程只加载一份模型，同一时刻只推理一个音频请求。繁忙时接口返回 429。当前没有账号或访问控制；公开网址上的任何人都能提交音频。
- openSMILE 的研究许可及 CFRAFN 代码、权重的公开演示授权须由项目方确认；本部署面向非商业研究演示。

## 从 GitHub 部署

1. 将本次修改（包括 `Dockerfile`、`.dockerignore`、`render.yaml`、`requirements.txt`、`backend/app.py`）提交并推送到项目 GitHub 仓库。不要提交 `.venv`、本地录音、`.env`、证书或 `models/vggish-10086976.pth`。
2. 开通 Render 账号后，打开 [这个项目的 Render 部署入口](https://render.com/deploy?repo=https://github.com/LiyuanTuo/srtp_intelligent_diagnosis)。它会读取公开仓库根目录的 `render.yaml`。检查创建预览中的新加坡地区、单实例、`1c-2g` 规格和费用后确认创建。也可在 Render Dashboard 选择 **New → Blueprint**，连接 `LiyuanTuo/srtp_intelligent_diagnosis` 的 `main` 分支。
3. 等待容器构建。构建会安装 CPU PyTorch 并下载约 289 MB 的 VGGish 权重，首次构建可能需要数分钟。服务启动后，`/api/ready` 只有在模型和解码器都可用时才返回 HTTP 200；否则返回 503，Render 不会把失败实例当作可用服务。
4. 从 Render 服务页取得实际分配的 `https://…onrender.com` 地址。打开首页与 `/tongue.html`，检查浏览器麦克风和相机权限；访问 `/api/health`，确认 `status` 为 `ready`。用非敏感测试录音提交一次，确认分析结果显示。手机上也应通过 HTTPS 真机检查。

## 绑定自己的域名

服务上线后，在 Render 服务的 **Settings → Custom Domains** 添加一个你们拥有的子域名，例如 `voice.example.com`。按 Render 界面给出的值在域名 DNS 管理处添加 CNAME，等待域名验证及 TLS 证书签发。Render 会将 HTTP 自动重定向到 HTTPS。没有自有域名时，平台分配的 `onrender.com` 地址已经可以公开访问并支持麦克风与相机权限。

## 更新与排查

- 为避免短期演示期间由代码推送触发额外构建，配置关闭自动部署。需要更新时，在 Render 服务的 Deploys 页面手动部署。先看构建日志、运行日志和 `/api/health`；模型加载失败时 `/api/ready` 为 503。
- 若构建阶段无法下载 VGGish 权重，检查上游下载地址与 SHA-256；不要绕过校验。
- 若资源不足或发生重启，检查 Render 的内存指标，再决定是否升级规格。不要增加 Uvicorn worker 数；每个 worker 都会重复加载模型。
- 默认未保存用户音频和结果，容器文件系统是临时的。服务器访问日志已在 Uvicorn 关闭；仍应检查托管平台的日志及项目隐私说明是否满足你们的研究要求。

## 10–15 天后结束演示

Render 的付费服务会持续计费，不能只停止访问网页。演示结束后，在 Dashboard 删除本次 Web Service，并在 Billing 页面核对最终用量；项目代码仍保留在 GitHub，之后可以重新创建服务。删除前先保存需要留存的部署日志或服务配置。不要只把服务切换到维护模式，因为这不会关闭实例。

Render 官方说明：[Web Services](https://render.com/docs/web-services)、[Compute Plans](https://render.com/docs/compute-plans)、[Custom Domains](https://render.com/docs/custom-domains)。
