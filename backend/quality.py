"""Advisory signal measurements only; never modify the model input or score."""
import numpy as np
from backend.audio import SAMPLE_RATE


def assess_quality(waveform):
    values = np.asarray(waveform, dtype=np.float64)
    rms = float(np.sqrt(np.mean(values ** 2)))
    peak = float(np.max(np.abs(values)))
    rms_dbfs = 20 * np.log10(max(rms, 1e-6))
    peak_dbfs = 20 * np.log10(max(peak, 1e-6))
    clipped_ratio = float(np.mean(np.abs(values) >= .98))
    frame_size = SAMPLE_RATE // 10
    frames = [values[i:i + frame_size] for i in range(0, len(values), frame_size)]
    quiet_ratio = float(np.mean([np.sqrt(np.mean(frame ** 2)) < .005623413 for frame in frames]))
    issues = []
    if rms_dbfs < -45:
        issues.append({"code": "low_volume", "message": "原录音音量偏低；分析时会自动统一音量，请试听确认人声清晰。"})
    if clipped_ratio >= .005:
        issues.append({"code": "possible_clipping", "message": "部分采样接近音量上限，可能出现失真；建议离麦克风稍远后重录。"})
    if quiet_ratio >= .6:
        issues.append({"code": "many_quiet_frames", "message": "较多片段音量很低，请试听是否存在长时间停顿或未录到声音。"})
    return {
        "rms_dbfs": round(float(rms_dbfs), 1), "peak_dbfs": round(float(peak_dbfs), 1),
        "clipped_sample_ratio": round(clipped_ratio, 4), "quiet_frame_ratio": round(quiet_ratio, 4),
        "issues": issues,
        "summary": "建议试听并考虑重录" if issues else "未发现明显音量异常，仍请以试听为准",
        "disclaimer": "仅检查音量与低音量片段，不能判断是否为清晰人声、环境是否安静或是否符合临床采集要求。",
    }
