# 声音评估接口

服务和静态网页同源。API 响应使用 `Cache-Control: no-store`。

## GET /api/health

返回 HTTP 200；必须检查 `status`，200 本身不代表模型可用。

```json
{
  "status": "ready",
  "model_ready": true,
  "decoder_ready": true,
  "model_version": "CFRAFN-9d15a266-8eea2553",
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
| `audio_duration_seconds` | number | 解码后实际参与分析的音频时长 |
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

浏览器录音/文件 → 有界 multipart 请求 → 临时文件 → FFmpeg 单声道 16 kHz → openSMILE eGeMAPSv02 Functionals + VGGish → PCA/量化并按时间平均 → CFRAFN → JSON。

音频临时文件在解码成功或失败后清理。服务不写音频数据库、结果数据库或请求正文日志；命令行默认关闭访问日志。结果在当前页面内存中显示，刷新即清空。


## 音频质量提示（体验完善版）

`audio_quality` 包含 `rms_dbfs`（整体均方根音量）、`peak_dbfs`（峰值）、`clipped_sample_ratio`（绝对幅度 ≥ 0.98 的采样比例）、`quiet_frame_ratio`（100 ms 帧中 RMS 低于约 −45 dBFS 的比例），以及 `summary`、`disclaimer`、`issues`。

`issues` 为 `{code, message}` 数组，可能包含 `low_volume`（整体 RMS < −45 dBFS）、`possible_clipping`（接近上限的采样 ≥ 0.5%）和 `many_quiet_frames`（低音量帧 ≥ 60%）。这些是工程提示阈值，不是经验证的临床质量标准。无提示也不能证明录到了清晰人声或处于安静环境。

计算使用解码后的音频副本，不归一化、不裁剪原始模型输入、不修改模型分数。原先近静音等无效音频仍直接报错，不产生报告。前端兼容暂未返回 `audio_quality` 的旧服务，缺失时隐藏质量区。
