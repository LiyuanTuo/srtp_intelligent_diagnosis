# 低成本单机部署：腾讯云新加坡轻量应用服务器

此方案在一台 Linux 服务器上运行现有 Docker 应用和 Caddy。Caddy 提供 HTTPS，Python 应用只在 Docker 内部网络监听 10000 端口。它保留网页、录音、相机、真实 CFRAFN/VGGish 推理和 `/api/ready` 检查。

## 选购

选腾讯云轻量应用服务器 **新加坡、Linux、2 核 4 GB、至少 60 GB 系统盘**，单实例。官方价目表在 2026-09-24 列出的入门型 60 GB 套餐为 **¥42/月**，含 30 Mbps 峰值带宽和 1536 GB/月出站流量；最终规格、库存和价格以支付页面为准。轻量应用服务器为包月预付费，短用 10 天仍按购买的整月支付。购买时不要开启自动续费，购买后在实例信息中复核。

来源：[腾讯云价格总览](https://cloud.tencent.com/document/product/1207/73452/)、[计费概述](https://cloud.tencent.com/document/product/1207/44368)、[关闭自动续费](https://cloud.tencent.com/document/product/1207/47835)。

新加坡与原计划的 Render 地区相同，但不同运营商的跨境网络表现会变动，正式展示前应在目标用户的手机网络上实测。**不要选 2 GB 内存套餐。**本机真实推理后 Windows 进程私有内存约 2.2 GB；Linux 数值可能不同，4 GB 留有更合理的空间。使用 x86_64 Ubuntu 24.04 或 22.04 镜像，不选择 ARM。开放 TCP 80、443，以及供 SSH 使用的 22；仅从自己的 IP 访问 SSH。应用的 10000 端口不对公网开放。

## 安装和启动

先按 [Docker 官方 Ubuntu 安装步骤](https://docs.docker.com/engine/install/ubuntu/)安装 Docker Engine 和 Compose 插件。然后在服务器中：

```sh
git clone https://github.com/LiyuanTuo/srtp_intelligent_diagnosis.git
cd srtp_intelligent_diagnosis
git switch deploy/lighthouse-vps
cp .env.example .env
```

编辑 `.env`，把 `203-0-113-10` 改成服务器的真实公网 IPv4 地址，以短横线分隔。例如公网 IP 为 `1.2.3.4` 时使用 `PUBLIC_HOSTNAME=voice.1-2-3-4.sslip.io`。`sslip.io` 是免费、无需注册的 IP 映射 DNS；Caddy 为该主机名自动申请公开信任的 HTTPS 证书。若已有自己的域名，也可以把域名的 A 记录指向服务器 IP，并直接用该域名作为 `PUBLIC_HOSTNAME`。使用第三方免费 DNS 时，正式演示前务必从目标网络验证可达性。

```sh
docker compose -f compose.vps.yaml config --quiet
docker compose -f compose.vps.yaml up -d --build
docker compose -f compose.vps.yaml ps
docker compose -f compose.vps.yaml logs --tail=100 app caddy
```

第一次构建会下载 CPU PyTorch 和约 289 MB 的 VGGish 权重；下载脚本校验 SHA-256。如果容器启动失败，先查看 `app` 日志中的 `Model initialization failed:`。Caddy 取证书需要服务器的 80 和 443 端口可从公网访问。

## 验收与结束

打开 `https://<PUBLIC_HOSTNAME>/api/ready`，确认 HTTP 200；再打开 `/api/health`，确认 `model_ready=true` 且 `decoder_ready=true`。用已授权的非敏感音频实际点击“提交并分析”，再在手机上测试麦克风和相机。只用 HTTP 或直接访问服务器 IP 时，浏览器可能不允许麦克风和相机；必须使用可信 HTTPS。

如果证书申请、目标网络访问或推理速度未达到要求，先保持 Render 服务原样，查看 `docker compose -f compose.vps.yaml logs` 并修复后再切换。`onrender.com` 地址归 Render 所有，无法迁移到新服务器，访问者需使用新地址或自有域名。

10 天演示结束后，可以先运行 `docker compose -f compose.vps.yaml down` 停止公开服务，再在腾讯云控制台关闭自动续费并核对到期日。包月套餐已付费用不会因停机自动按天减少。若有用户音频和日志需要留存，按项目隐私要求处理；当前应用不持久保存上传音频和结果。

参考：[Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https)、[sslip.io 使用说明](https://sslip.io/)、[浏览器录音的 HTTPS 要求](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)。
