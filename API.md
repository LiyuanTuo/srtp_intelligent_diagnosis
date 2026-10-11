# 声音评估接口

服务和静态网页同源。API 响应使用 `Cache-Control: no-store`。

## GET /api/health

返回 HTTP 200；必须检查 `status`，200 本身不代表模型可用。

```json
{
  "status": "ready",
  "model_ready": true,
  "decoder_ready": true,
  "model_version": "CFRAFN-9d15a266-8eea2553-prep1",
  "classification_verified": false,
  "message": "研究模型已就绪；类别解释待确认。",
  "limits": {"max_seconds": 180, "min_seconds": 2, "max_bytes": 26214400}
}
```

未就绪时 `status=unavailable`。启动错误详细原因只写到服务端日志。

## POST /api/voice/analyze

`multipart/form-data`：`audio` 为单个音频文件，`consent` 为 `true`。沿用真实文件容器及扩展名；不要仅把 WebM 标成 WAV。服务检测内容并解码，不仅根据 MIME 判断。

成功 HTTP 200：

| 字段 | 类型 | 含义 |
|---|---|---|
| `model_version` | string | 上游提交及 CFRAFN 权重摘要 |
| `score` | number | 0–1 的原始 Sigmoid 输出，不是患病概率 |
| `classification` | null | 类别解释未确认，暂不提供分类 |
| `classification_verified` | boolean | 当前始终为 false |
| `audio_duration_seconds` | number | 去除首尾静音前的录音时长 |
| `preprocessing` | object | 预处理版本、增益、裁剪位置和实际分析片段时长，见下文 |
| `analysis_seconds` | number | 解码、特征提取、推理总耗时，不含上传 |
| `warnings` | string[] | 类别解释、预处理和特征顺序的局限 |
| `audio_quality` | object | 独立的音频信号测量与操作建议，不改变模型分数 |

当前接口不提供焦虑、压力、情绪稳定性、临床严重程度或趋势数据。前端不能从单个分数推导这些指标。

失败结构：

```json
{"error":{"code":"silent_audio","message":"未检测到有效声音，请检查麦克风后重录。"}}
```

| HTTP | 错误码 | 含义 |
|---|---|---|
| 400 | `consent_required` | 未授权处理 |
| 413 | `file_too_large` | 文件超过 25 MB，或请求头/表单额外开销超过限制 |
| 415 | `unsupported_format` | 扩展名不支持 |
| 422 | `invalid_request` | 缺少文件、授权或字段格式不正确 |
| 422 | `empty_audio` / `decode_failed` | 文件为空或无法解码 |
| 422 | `audio_too_short` / `audio_too_long` | 时长不符合技术限制 |
| 422 | `silent_audio` / `invalid_audio` / `invalid_features` | 近静音、采样无效或特征无法提取 |
| 429 | `service_busy` | 正在处理其他音频，可以稍后重试 |
| 503 | `model_unavailable` / `decoder_unavailable` | 服务依赖未就绪 |
| 503 | `analysis_failed` / `invalid_prediction` | 推理异常或输出无效 |

浏览器网络断开或 180 秒等待超时不代表服务端计算已取消。失败不返回分数，前端隐藏旧结果并允许重试。

## 数据流

浏览器录音/文件 → 有界 multipart 请求 → 临时文件 → FFmpeg 保留原采样率和声道解码 → 声道算术平均 → resampy kaiser_best 重采样至 16 kHz → 峰值归一化 → librosa 首尾静音裁剪 → 内存 PCM_16 WAV 往返 → openSMILE eGeMAPSv02 Functionals + VGGish → PCA/量化并按时间平均 → CFRAFN → JSON。

音频临时文件在解码成功或失败后清理。服务不写音频数据库、结果数据库或请求正文日志；命令行默认关闭访问日志。结果在当前页面内存中显示，刷新即清空。


## 音频质量提示（体验完善版）

`audio_quality` 包含 `rms_dbfs`（整体均方根音量）、`peak_dbfs`（峰值）、`clipped_sample_ratio`（绝对幅度 ≥ 0.98 的采样比例）、`quiet_frame_ratio`（100 ms 帧中 RMS 低于约 −45 dBFS 的比例），以及 `summary`、`disclaimer`、`issues`。

`issues` 为 `{code, message}` 数组，可能包含 `low_volume`（整体 RMS < −45 dBFS）、`possible_clipping`（接近上限的采样 ≥ 0.5%）和 `many_quiet_frames`（低音量帧 ≥ 60%）。这些是工程提示阈值，不是经验证的临床质量标准。无提示也不能证明录到了清晰人声或处于安静环境。

质量计算使用单声道重采样后、归一化和裁剪前的音频，不修改该音频；模型特征则从预处理后的独立副本提取。原先近静音等无效音频仍直接报错，不产生报告。前端兼容暂未返回 `audio_quality` 的旧服务，缺失时隐藏质量区。


## 预处理 v1（2026-10-11）

按用户提供的 `preprocess.py` 接入：声道算术平均、`resampy.resample(filter="kaiser_best")`、除以整段绝对峰值、`librosa.effects.trim(top_db=60, ref=np.max, frame_length=2048, hop_length=512)`，最后在内存中按 PCM_16 保存并读回，以对齐脚本输出 WAV 的量化。保留中间停顿。所有有效提交都执行此流程，不通过文件名猜测是否已经处理过；不加入 AGC、压缩或降噪到模型输入。

`preprocessing` 返回 `version`（`cfrafn-preprocess-v1`）、`sample_rate`、`resampler`、`normalization`、`gain_db`、`silence_top_db`、`output_subtype`、`input_duration_seconds`、`processed_duration_seconds`、`trimmed_start_seconds`、`trimmed_end_seconds`。health 也返回 `preprocessing_version`。模型版本追加 `-prep1`，权重本身未变。

近静音/非有限数值在放大前拒绝；去除首尾静音后不足 2 秒返回 `audio_too_short`。为限制原采样率解码的资源使用，临时 WAV 上限为 128 MiB（`decoded_audio_too_large`，422）；采样率范围 4–192 kHz、声道数 1–8，超出返回 `unsupported_audio_parameters`（422）。25 MB 上传、180 秒录音限制保持不变。
