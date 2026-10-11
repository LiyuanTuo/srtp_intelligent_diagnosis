# 声语 · SRTP 声音评估

基于 ourSRTP 蓝白卡片界面与 CFRAFN 的研究演示网页。当前优先调试电脑网页版；可录音或选择已有音频、试听、重录、提交真实模型分析。已加入舌像采集引导、相机拍照、相册选择与人工检查流程。

**当前只显示研究模型分数，不显示患病概率或抑郁风险结论。** 类别解释、权重对应的训练配置和特征顺序仍需作者核对，详见 `VERIFICATION.md`。本项目没有模拟成功结果，也不在请求过程中训练模型。

## 在当前电脑启动

项目目录为 `D:\c++\codex\srtp-智能舌诊`。在项目目录运行：

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --no-access-log
```

打开 http://localhost:8000 。也可使用 `./scripts/start.ps1`。停止服务：在启动终端按 Ctrl+C。

## 从源码重新安装

使用 Python 3.12。以下以 Windows PowerShell 为例：

```powershell
py -3.12 -m venv .venv
$env:PYTHONUTF8 = '1'
.\.venv\Scripts\python.exe -m pip install torch==2.3.1 --index-url https://download.pytorch.org/whl/cpu
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe scripts/download_vggish.py
.\scripts\start.ps1
```

`PYTHONUTF8=1` 用于解决 torchvggish 安装脚本在中文 Windows 下读取说明文件的编码问题。`requirements-lock.txt` 记录了本次 Windows/Python 3.12 的全部实际依赖；若需要完全复现，可在安装 CPU PyTorch 后用它替代 `requirements.txt`。其他操作系统使用 `.venv/bin/python` 并单独安装适合平台的 PyTorch。

CFRAFN 权重约 2 MB，随项目保留；VGGish 权重约 289 MB，不加入 Git，下载脚本会校验 SHA-256。模型启动只读取本地文件，不自动访问网络。

Render 上修复“模型尚未就绪”、部署到现有服务及验收步骤见 [DEPLOY.md](DEPLOY.md)。

默认使用 `imageio-ffmpeg` 随包提供的 FFmpeg。需要指定二进制时设置 `FFMPEG_PATH`。openSMILE 若遇到中文路径，程序会把配置复制到系统临时目录并在服务关闭时清理；若系统临时目录也包含非 ASCII 字符，可将 TMP/TEMP 指向可写的 ASCII 路径。

## 手机联调

手机浏览器的麦克风要求安全上下文；电脑的 localhost 不等于手机的 localhost。使用手机能访问的主机地址和手机已信任的 HTTPS 证书：

```powershell
.\scripts\start.ps1 -BindAddress 0.0.0.0 -Port 8443 -Certificate 'C:\certs\server.pem' -PrivateKey 'C:\certs\server-key.pem'
```

证书需覆盖实际访问的域名或 IP，且由手机信任。这里不自动安装证书、不修改防火墙，也不公开部署服务。当前无登录系统，联调限于受控研究环境。Android/iPhone 真机检查清单见验证记录。

## 使用流程

1. 首次访问阅读录音用途弹窗，点击“我了解用途”。当前没有账号系统，确认状态按浏览器及站点保存在 localStorage；清除站点数据或更换浏览器后会再次显示。
2. 点击“开始录音”，先保持安静 3 秒完成环境声初步检查，再按显眼位置的固定朗读材料完整朗读（浏览器不支持检测时直接录音）；满 2 分钟显示文字提醒，满 3 分钟自动停止，停止后释放麦克风。也可点击“提交已有音频”选择本地文件；录好或选好音频后显示“提交并分析”，选择文件本身不会上传。
3. 试听，不满意时重录；听不清可开启“增强试听”，它只改变播放音量。替换录音时取消会保留之前的有效音频。
4. 提交分析，页面显示上传进度与分析状态。后端自动统一峰值幅度并裁剪首尾静音，再提取模型特征；失败保留当前音频供重试。
5. 查看真实模型分数、模型版本、时长、耗时及局限说明。

限制：音频 2–180 秒、25 MB；支持 WAV、WebM、OGG、MP4/M4A、MP3、FLAC。2 秒最低时长是技术限制，不是临床标准。为容纳浏览器编码器最后一帧，180–180.5 秒音频会截至 180 秒，更长音频被拒绝。

音频只发送到本应用服务，临时文件在解码后清理；结果不写入数据库、浏览器存储或历史记录。取消等待会终止客户端请求，但服务端可能仍完成已收到音频的计算并清理。录音前进行 3 秒环境声初步检查，提示背景输入偏大、声音变化较大或几乎没有输入；这段检查不写入录音。录音时可查看实时音量；持续低音量、瞬时接近上限、麦克风输入暂停或断开会给出提示，音量计不可用时仍可录音。环境检查是未校准的音量提示，不是噪声分类；研究与 GitHub 调研来源见 SOURCES.md。报告额外显示低音量、接近削波和长时间低音量片段的操作建议，不修改模型分数。系统不进行可靠的人声识别、噪声识别或临床质量判断。手机端默认折叠较长的操作建议，用途说明通过首次访问弹窗展示。

## 舌像采集

从左侧“舌像采集”进入，或打开 http://localhost:8000/tongue.html 。

1. 对照姿势示意与三条拍摄建议，调整光线和镜头位置。
2. 点击“开启相机”并允许权限，自然伸舌对准轮廓，点击“拍照”直接拍摄；需要准备时间时，可勾选“延时 3 秒拍照”，默认关闭。支持请求切换前后置相机。没有摄像头时可从相册选择 JPG / PNG / WebP（≤15 MB、≤2400 万像素）。
3. 拍照后相机自动关闭；对照三条说明检查完整度、纹理清晰度和均匀照明，勾选“我已确认完毕”后使用，或重新拍摄 / 选择。勾选状态在同一浏览器及站点中记住，后续默认勾选；手动取消勾选会同步取消默认状态。浏览器存储不可用时，仅在当前页面内记住。
4. 照片只保留在本页内存，刷新或离开后清除；可主动下载保存。**当前没有舌像上传、识别或诊断接口。**

相机需要 HTTPS 或本机 localhost。前置预览镜像，成片为正常方向；引导线不会写入照片。切换到后台、取消或离开页面会关闭相机。亮度提示仅为画面中央区域的经验估计，不表示自动识别到舌头或照片质量合格；具体阈值、参考来源及答辩表述见 `SOURCES.md`。Android / iPhone 摄像头兼容性需真机验收。

## 接口

- `GET /api/health`：模型和解码器是否就绪。
- `POST /api/voice/analyze`：multipart 文件字段 `audio`，授权字段 `consent=true`。
- `/docs`：FastAPI 交互接口说明；完整字段和错误码见 `API.md`。

服务单进程加载一次模型并复用，CPU 推理同时处理一个请求；忙时返回 429。单请求总大小在 multipart 解析前限制，临时文件也会在错误时清理。不要用多个 worker 在内存不足的电脑上重复加载模型。

## 验证

```powershell
.\.venv\Scripts\python.exe -m pytest -q
node --test tests/recorder.test.cjs
node --test tests/tongue.test.cjs
```

真实模型集成测试使用公开授权的 LibriSpeech 片段，不属于抑郁症验证数据：

```powershell
New-Item -ItemType Directory -Force .cache
Invoke-WebRequest 'https://librosa.org/data/audio/5703-47212-0000.ogg' -OutFile .cache/libri1.ogg
.\.venv\Scripts\python.exe scripts/verify_model.py .cache/libri1.ogg
$env:RUN_MODEL_TESTS = '1'
.\.venv\Scripts\python.exe -m pytest -q
```

样本：Garth Comira 朗读《Ashiel Mystery - A Detective Story》第 2 章，来自 [LibriSpeech SLR12](https://www.openslr.org/12/)，采用 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)；[librosa 样本说明](https://librosa.org/data/audio/5703-47212-0000.txt)。样本下载到 Git 忽略的 `.cache`，不作为产品示例报告展示。

## 代码结构

| 目录 | 内容 |
|---|---|
| `web/` | 单页界面、响应式样式、录音与请求控制 |
| `backend/` | API、音频解码、推理、上传限制和 Windows 兼容 |
| `models/` | 权重、特征列表、特征权重 |
| `vendor/` | 固定版本上游源码与 UI 参考，网页不会执行此目录 |
| `scripts/` | 启动、权重下载、单音频验证 |
| `tests/` | API/解码测试、真实模型集成测试、录音控制单元测试 |

原始来源、版本、差异和授权状态见 `SOURCES.md`。本轮未实现社区、账号、专用设备接入、历史记录、安装版或舌像分析。


## 音频预处理更新（2026-10-11）

模型分析按用户提供的 `preprocess.py` 执行单声道算术平均、resampy `kaiser_best` 16 kHz 重采样、峰值归一化、60 dB 相对阈值的首尾静音裁剪，以及内存 PCM_16 WAV 量化往返。不会删除句子中间的停顿，也不加入语音压缩或降噪。增益与裁剪信息随 API 返回，预处理版本为 `cfrafn-preprocess-v1`，模型版本增加 `-prep1`。

录音质量检查仍测量归一化前的声音。自动放大不能改善信噪比，也不会掩盖原始低音量、过响提示。网页的“增强试听”独立于模型预处理，上传文件和本地原音频不会被覆盖。所有上传均按相同流程处理，不能依据 `_processed` 文件名跳过步骤。

录音前对稳定背景声建立音量参考，持续接近底噪时仍提示开口朗读；这是音量启发式提示，不是风扇识别或实际降噪。固定朗读材料由用户提供，独立显示；其他录音建议默认折叠。
