# 来源与复现说明

## UI

- 仓库：https://github.com/Rosmontisss/ourSRTP
- 固定提交：`2aa4725225cc5781df5835daae5dea9c02ee626f`
- 原始录音页保存在 `vendor/original-voice-collection.html`，用于设计和行为对照。
- 本实现保留蓝白配色、卡片、录音引导和响应式思路，重新实现单页流程；没有复用虚构指标、模拟上传或硬编码登录。

## CFRAFN

- 仓库：https://github.com/Sook13/CFRAFN
- 固定提交：`9d15a2660dbf25cdd748b49119491b8c7f34fd92`
- `vendor/cfrafn_model.py` 为上游 `code/tools/model.py`，未改动；`vendor/upstream_utils.py` 仅保留作对照，不参与运行。
- 论文：CFRAFN: A Cross-Feature Residual Attention Fusion Network for Major Depressive Disorder Prediction Using Clinical Voice Recordings，DOI https://doi.org/10.1109/JBHI.2026.3677472 。本实现基于公开代码，未宣称复现论文准确率。

| 文件 | SHA-256 |
|---|---|
| `best_CFRAFN.pth` | `8eea255342dad44aec81fa2544a2a906d154df40618847151db54234ce5629d8` |
| `eGe_feature_cumul1.txt` | `bc54d03f6887c2039886bd0fa633caaaa48762b5c805c2eb797c71b568a6d2f5` |
| `sorted_feature_importance.csv` | `8ebe29f8f224003de801d5482a3a15018d8424e946c86fd60ee1238870ca8657` |

两个用户指定的仓库在所读取的文件树中均未提供独立 LICENSE。本地研究实现保留来源记录；不据此宣称已取得再分发或商业使用授权。

## VGGish / openSMILE

- 固定使用 PyPI `torchvggish==0.2`，源项目：https://github.com/harritaylor/torchvggish 。其 master 与 PyPI 0.2 接口不同，运行代码按已安装版本编写。`vendor/vggish-reference.py` 仅为核对接口时取得的参考，不参与运行。
- VGGish 网络权重：https://github.com/harritaylor/torchvggish/releases/download/v0.1/vggish-10086976.pth
- PCA 参数使用 AudioSet 官方 NPZ：https://storage.googleapis.com/audioset/vggish_pca_params.npz 。通过 `numpy.load(allow_pickle=False)` 加载，再执行 torchvggish 0.2 的白化、裁剪、量化运算。避免上游 PCA pickle 的非受限反序列化。
- VGGish 网络与 CFRAFN 均使用 `torch.load(weights_only=True)` 加载，再 `strict=True` 校验网络参数。VGGish 下载脚本固定 SHA-256。
- openSMILE：https://github.com/audeering/opensmile-python ，使用 `eGeMAPSv02` / `Functionals`。其许可条款随安装包保留，当前场景为研究演示。

## 与训练入口的差异

1. 从发布权重的张量形状确定网络尺寸，而非使用当前训练脚本的默认超参数。
2. 不读取训练数据、不进行随机增强、不训练；仅执行 `eval()` 与 `inference_mode()`。
3. 按公开特征提取代码保留 openSMILE 原始列顺序，同时保留上游排序后的特征权重。两者顺序确有差异，未擅自修正。
4. 后端将浏览器容器解码为单声道 16 kHz；没有加入未经确认的幅度归一化或去静音阈值。
5. VGGish 分批处理并保留单窗口的 batch 维，避免上游 `squeeze()` 导致的维度错误。
6. 使用 CPU 并固定线程上限，以便普通电脑运行；没有承诺 GPU 或其他设备上的相同耗时。

公开技术测试样本的署名和许可见 README。它不包含抑郁标签，也不能用于诊断能力评估。

## 舌像采集 UI（2026-10-10）

### 采用的参考

| 来源 | 可核对的位置 / 授权标识 | 本项目采用范围 |
|---|---|---|
| Segawa M, Iizuka N, Ogihara H, et al. **Construction of a Standardized Tongue Image Database for Diagnostic Education: Development of a Tongue Diagnosis e-Learning System**. Frontiers in Medical Technology, 2021, 3:760542. [DOI / 原文](https://doi.org/10.3389/fmedt.2021.760542) | Materials and Methods → Step 1、Step 2；Figure 1；开放获取论文，文中同时披露采集系统的日本专利申请 | 参考“拍摄画面叠加舌形轮廓，减少位置、方向差异”的交互思路，以及均匀照明、短暂伸舌拍摄的注意点。没有使用论文照片、设备方案或源代码，也未声称复现其标准化采集条件。 |
| WebRTC project authors, **WebRTC samples: getUserMedia to canvas**. [GitHub 目录](https://github.com/webrtc/samples/tree/gh-pages/src/content/getusermedia/canvas) · [具体 JS 文件](https://github.com/webrtc/samples/blob/gh-pages/src/content/getusermedia/canvas/js/main.js) · [在线演示](https://webrtc.github.io/samples/src/content/getusermedia/canvas/) | `src/content/getusermedia/canvas/js/main.js`，`gh-pages` 分支，访问日期 2026-10-10；[LICENSE.md](https://github.com/webrtc/samples/blob/gh-pages/LICENSE.md)，BSD-3-Clause | 学习 `getUserMedia → video.srcObject → canvas.drawImage` 的浏览器 API 用法。未拷贝该文件或引入其运行依赖；本项目独立编写权限状态、倒计时、4:3 可见区域截图、资源清理和复核流程。 |

网页底部“设计与技术参考”也提供上述链接，便于现场演示时说明。API 参考为访问时的分支链接，未取得固定提交 SHA；不将其表述为固定版本的源码复现。

### 调研过、但未集成的 GitHub 项目

| 项目 | 已核查的公开内容 | 本轮结论 |
|---|---|---|
| [TonguePicture-SKaRD/TongueDiagnosis](https://github.com/TonguePicture-SKaRD/TongueDiagnosis) | README 的上传 → YOLOv5 定位 → SAM 分割 → ResNet50 分类流程；仓库声明 AGPL-3.0 | 可作为后续分析链路调研入口，本轮未复制其 UI、代码或权重，也没有使用其模型或诊断结果。它不是本页拍摄引导的直接实现来源。 |
| [mansikataria/tongue-tip-detection-and-tracking](https://github.com/mansikataria/tongue-tip-detection-and-tracking) | README 的实时舌尖检测与追踪、Python / OpenCV / dlib 技术栈 | 适合研究实时定位，但舌尖追踪不等于完整舌像质量评估。本轮只阅读公开说明，未采用源码；所查看的仓库根目录未见独立 LICENSE，不推定可直接复制。 |

### 本项目完成的工作与边界

- `web/tongue.html`、`web/tongue.css`：延续现有蓝白卡片风格，新增三步采集流程、原创 SVG 姿势示意与错误拍摄示意、舌形参考框、人工检查清单、放大预览及本地下载。
- `web/tongue.js`：独立编写相机权限处理、前后置偏好切换、3 秒倒计时、相册选择、照片确认与重拍；拍照、取消、设备中断、页面隐藏及离开时释放摄像头。没有请求舌像分析接口。
- 相机预览固定 4:3，截图与可见区域一致；前置预览镜像、成片为相机正常方向。照片最长宽度 1920 px，JPEG 编码质量参数 0.95；不叠加辅助线、不磨皮、不调色。相册照片按原文件保留，不裁剪、不重新编码。
- `web/tongue-quality.js`：原创亮度提示。对中央小区域降采样为 64×64，以 `0.2126R + 0.7152G + 0.0722B` 作近似亮度；均值 <55 提示偏暗，均值 >220 或亮度 >245 的像素占比 >25% 提示偏亮。照片短边 <480 px 时提示分辨率偏低。以上都是 UI 经验阈值，**没有经过舌像数据集或临床验证**，不是照度测量、颜色校准或合格判定。
- 没有舌体检测、自动清晰度检查或自动合格率。完整度、清晰度与光线均由用户查看照片后勾选；普通物体照片也可能被用户确认，本页不宣称能排除非舌像。
- 所有图像留在当前浏览器页面内存，离开页面或刷新后清除；只有主动下载才保存到用户设备。没有数据库、历史记录或舌像模型推理。

### 答辩时可使用的表述

> 我们参考 Segawa 等人关于舌形取景框的采集思路，并参考 WebRTC 官方示例的浏览器相机 API 用法，自行实现了拍摄指引、倒计时、亮度粗略提示和人工复核流程。当前完成的是舌像采集交互；它不包含自动舌体识别，也未验证医学图像质量或诊断效果。

不要将调研项目写成已集成模块，也不要把人工勾选完成写成“AI 检测合格”。引用来源不等于获得其他项目的源码或模型再分发授权。


## 声音采集题目与录音环境提示（2026-10-10）

### 采集题目的研究来源

- Cai H, Yuan Z, Gao Y, et al. **A multi-modal open dataset for mental-disorder analysis**. Scientific Data 9, 178 (2022). [原文](https://doi.org/10.1038/s41597-022-01211-x)。Methods 的 Recordings of spoken language experiment 描述中文访谈、朗读、看图描述三类任务；访谈包含 18 个正性、中性、负性问题。可参考的问题方向包括假期出行计划和介绍朋友（此处是中文概括，不是正式量表或完整题库）。数据获取需要遵守作者及存储库的 EULA。
- [USC 官方 DAIC-WOZ / Extended DAIC 页面](https://dcapswoz.ict.usc.edu/)：公开描述了虚拟访谈员 Ellie 主持的临床访谈数据及申请流程。它可作为访谈流程的研究来源，不能直接当作适用于中文 CFRAFN 的统一朗读题库。
- [CFRAFN 官方 README](https://github.com/Sook13/CFRAFN#demo)：作者说明研究数据受隐私和保密要求限制，不在 GitHub 公开；本轮未找到足以核实当前权重所需完整采集题目与顺序的公开材料。需要与作者确认训练时的语言、任务、时长、预处理和标签含义后再固定采集方案。没有把网页的演示段落改称“已验证临床题目”。

### GitHub 候选方案与采用状态

| 项目 | 能力与许可 | 本轮采用状态 |
|---|---|---|
| [ricky0123/vad](https://github.com/ricky0123/vad) · [API](https://docs.vad.ricky0123.com/user-guide/api/) · [许可](https://github.com/ricky0123/vad/blob/master/LICENSE) | 浏览器运行 Silero VAD / ONNX Runtime；onFrameProcessed 提供人声概率，可作为后续区分说话与非说话帧的基础。包装代码 ISC，仓库列出的 Silero 模型许可 MIT；实际集成时还需保留各依赖许可。 | 已调研，未安装、未复制代码或模型。VAD 不是环境噪声类别识别器。后续可结合非人声帧音量估计背景声；需用目标麦克风与噪声样本验证。 |
| [xiph/rnnoise](https://github.com/xiph/rnnoise) | RNN 降噪库，BSD-3-Clause；官方例程使用 48 kHz 单声道 PCM。 | 已调研，未接入。它主要改变音频以压低噪声；当前训练预处理仍待核实，因此不直接用于修改送入 CFRAFN 的录音。 |

以上链接核查日期为 2026-10-10，属于调研来源而不是已集成依赖；未固定提交或声称复现。

### 本轮实际实现

`web/app.js` 独立实现浏览器 Web Audio 检查：授权麦克风后先提示保持安静 3 秒，正式 MediaRecorder 在检查完成后才开始，因此检查片段不写入提交音频，也不计入两分钟提醒或三分钟上限。未引入外部模型、CDN 或第三方音频上传。

检查每 100 ms 读取一帧幅度，以 RMS 换算 dBFS；至少 10 帧才作提示。检查期 90% 与 10% 分位之差 >15 dB 时提示声音不稳定（可能说话或突发声），否则中位数 >−40 dBFS 时提示环境声可能偏大；中位数 <−90 dBFS 时提示几乎没有输入信号。数据不足或浏览器不支持时说明检查不可用，仍允许录音。录音中保留持续低音量、接近削波提示，新增输入静音/设备断开提示；设备断开时停止录音并保留已录片段供试听。

这些阈值是尚未经过数据集或真实设备校准的操作提示，**dBFS 不是环境声压级 dB SPL**，不能与论文中的房间噪声阈值直接换算。检查时需用户保持安静；无法可靠识别人声、电视、音乐、突发噪声类别，亦不评价临床音频是否合格。后端音频和模型推理流程保持原有实现。

验证：19 项前端测试通过，包含合成幅度下的环境声偏大、输入变化、零输入、检测不可用、取消、计时、设备中断和资源释放；它们不代表真实嘈杂场景的识别准确率。


### 声音结果水球图调研与实现（2026-10-10）
- 调研现成方案：[ecomfe/echarts-liquidfill](https://github.com/ecomfe/echarts-liquidfill)，BSD-3-Clause，ECharts 插件，支持多层波浪、水位动画和自定义颜色。
- 本页未引入 ECharts 或复制该插件代码。`web/index.html`、`web/styles.css` 和 `web/app.js` 使用原创 SVG/CSS 实现单个水球，避免为一个指标增加图表运行库。无需外部 CDN。
- 水位直接映射原始分数 0–1，颜色在绿（0）、黄（0.5）、红（1）之间连续插值；中心保留四位小数。颜色不是临床风险分级，未新增诊断或概率解释。尊重系统“减少动态效果”设置。
- 音频替换保留原文件及其提示，直到新录音完成或选择有效文件；取消、权限失败、空文件不会提前撤销旧音频 URL。显式“开始新的评估”仍清空当前评估。
- 前端去掉用户标注的分数旁说明和底部重复警告；后端验证状态、原始警告和模型计算未变。
- 当前音频关联的环境检查和录音异常提示会与服务端音量检查合并去重；有异常时质量框前置。选择另一个文件时不会沿用上一次录音的提示。


### 水球数字与交互演示更新（2026-10-10）
- 正式结果与 `/gauge-demo.html` 共用 `web/liquid-gauge.js`：SVG 的水面和白色数字使用同一条动态 path，液面以上显示黑字，以下显示白字；移除白色数字底板并放大字号。
- 演示页提供 0.15、0.50、0.85 三个对比示例，以及 0–1 连续滑块、预设按钮和键盘微调。页面明确标注为演示数值，不请求模型分析、不使用录音。
- `重新录制` 与 `选择音频` 拆成两个描边按钮；前者直接开始新录音，后者直接打开文件选择。沿用新音频就绪后才替换原音频的规则。
- 环境提示保持单行，超过可用宽度时允许横向滚动查看全文。单元测试覆盖共享裁切路径、空满水位端点及重录取消时的音频保留。


### 水球视觉定稿调整（2026-10-10）
- 按新的视觉反馈恢复原先黄色与正弦波浪；数字改为单层，颜色与外圈同步。
- 用户确认的最终样式：中央为半径 88 的实边浅灰色圆（`#f3f7fa`），与水球未填充区域同色；不使用模糊。外围保留原始波浪，单层数字随外圈颜色同步变化。替代此前黑白裁切数字及高斯模糊衬底方案。
- 正式结果页和演示页继续共用同一渲染器。27 项交互与渲染测试通过，浏览器核对了低、中、高三档数字与外圈颜色一致。
