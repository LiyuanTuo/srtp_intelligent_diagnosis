"""Single-recording inference. Never trains or substitutes random predictions."""
import hashlib
import os
import threading
from pathlib import Path

import numpy as np
import pandas as pd
import torch

from backend.audio import AudioError, SAMPLE_RATE, PREPROCESSING_VERSION, prepare_model_audio

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "models"


class VoiceModel:
    def __init__(self):
        self.ready = False
        self.error = None
        self.version = "CFRAFN-9d15a266-prep1"
        self.classification_verified = False
        self.lock = threading.Lock()
        self.audit = {}

    def close(self):
        if hasattr(self, "smile"):
            self.smile.close()
        self.ready = False

    def load(self):
        self.close()
        self.error = None
        try:
            self._load()
            self.ready = True
        except Exception as exc:
            self.error = f"{type(exc).__name__}: {exc}"
            self.close()

    def _load(self):
        import opensmile
        from backend.smile_compat import LocalSmile
        from vendor.cfrafn_model import CFRAFN
        from torchvggish.torchvggish import VGG, make_layers

        torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
        torch.manual_seed(42)
        self.smile = LocalSmile(
            feature_set=opensmile.FeatureSet.eGeMAPSv02,
            feature_level=opensmile.FeatureLevel.Functionals,
        )
        selected = (MODEL_DIR / "eGe_feature_cumul1.txt").read_text(encoding="utf-8-sig").splitlines()
        self.features = [name.strip() for name in selected if name.strip()]
        if len(self.features) != 88 or len(set(self.features)) != 88:
            raise ValueError("Expected 88 distinct eGeMAPS features")
        if set(self.features) != set(self.smile.feature_names):
            raise ValueError("eGeMAPS feature names do not match the supplied feature list")
        weights = pd.read_csv(MODEL_DIR / "sorted_feature_importance.csv", index_col=0).squeeze("columns").loc[self.features]
        checkpoint = MODEL_DIR / "best_CFRAFN.pth"
        state = torch.load(checkpoint, map_location="cpu", weights_only=True)
        # Released checkpoint differs from main.py defaults; reconstruct its exact
        # layer dimensions, then require all keys and tensor shapes to match.
        transformed = state["eGeMAPS_transform.weight"].shape[0]
        architecture = {
            "transformed_feature_dim": transformed,
            "expansion": state["eGeMAPS_net.0.mlp.0.weight"].shape[0] // transformed,
            "conv_out_channels": state["VGGish_net.0.conv.0.weight"].shape[0],
            "resblock_kernel_size": state["VGGish_net.0.conv.0.weight"].shape[2],
            "cls_dim": state["classifier.0.weight"].shape[0],
        }
        self.model = CFRAFN(88, 128, weights, dropout=0.1, **architecture).cpu()
        # Upstream feature_weights is not a registered buffer.
        self.model.feature_weights = self.model.feature_weights.cpu()
        self.model.load_state_dict(state, strict=True)
        self.model.eval()
        digest = hashlib.sha256(checkpoint.read_bytes()).hexdigest()
        self.version = "CFRAFN-9d15a266-" + digest[:8] + "-prep1"

        # Explicit local assets; no downloads and no unrestricted pickle loading at startup.
        vgg_weights = MODEL_DIR / "vggish-10086976.pth"
        pca_weights = MODEL_DIR / "vggish_pca_params.npz"
        if not vgg_weights.exists() or not pca_weights.exists():
            raise FileNotFoundError("VGGish weights missing: run scripts/download_vggish.py")
        self.vgg = VGG(make_layers(), postprocess=False)
        self.vgg.load_state_dict(torch.load(vgg_weights, map_location="cpu", weights_only=True), strict=True)
        self.vgg.eval()
        with np.load(pca_weights, allow_pickle=False) as pca:
            self.pca_matrix = torch.as_tensor(pca["pca_eigen_vectors"].copy()).float()
            self.pca_means = torch.as_tensor(pca["pca_means"].copy().reshape(-1, 1)).float()
        if self.pca_matrix.shape != (128, 128) or self.pca_means.shape != (128, 1):
            raise ValueError("Unexpected VGGish PCA shape")
        self.audit = {
            "checkpoint_sha256": digest, "ege_features": len(self.features),
            "architecture": architecture,
            "feature_order_matches_selected_list": list(self.smile.feature_names) == self.features,
            "vggish_features": 128, "strict_load": True,
            "feature_order": "upstream_extractor_order_with_upstream_weight_vector",
            "preprocessing": PREPROCESSING_VERSION,
        }

    def predict(self, waveform):
        from torchvggish import vggish_input

        if not self.ready:
            raise AudioError("model_unavailable", "模型尚未就绪，请查看服务状态或联系项目维护者。", 503)
        waveform, preprocessing = prepare_model_audio(waveform)
        # Match public inference extraction: upstream preserves openSMILE column order
        # but applies importance weights in the selected-list order. Do not silently
        # correct that discrepancy without evidence of the checkpoint's training recipe.
        frame = self.smile.process_signal(waveform, SAMPLE_RATE)
        ege = frame.to_numpy(dtype=np.float32)
        if ege.shape != (1, 88) or not np.isfinite(ege).all():
            raise AudioError("invalid_features", "无法提取完整声学特征，请录制清晰且更长的人声。")
        examples = vggish_input.waveform_to_examples(waveform, SAMPLE_RATE)
        if len(examples) == 0:
            raise AudioError("audio_too_short", "有效声音太短，无法提取特征。")
        with torch.inference_mode():
            batches = []
            for start in range(0, len(examples), 16):
                embeddings = self.vgg(examples[start:start + 16])
                # Same whitening, clipping, quantization as torchvggish==0.2;
                # preserve batch dimension even for the last single window.
                projected = torch.mm(self.pca_matrix, embeddings.t() - self.pca_means).t()
                batches.append(torch.round((torch.clamp(projected, -2., 2.) + 2.) * (255. / 4.)))
            vgg = torch.cat(batches).mean(dim=0, keepdim=True)
            score = float(self.model(torch.from_numpy(ege), vgg).item())
        if not np.isfinite(score) or not 0 <= score <= 1:
            raise AudioError("invalid_prediction", "模型返回了无效结果，请联系项目维护者。", 503)
        return {
            "model_version": self.version,
            "score": score,
            "classification": None,
            "classification_verified": False,
            "preprocessing": preprocessing,
            "warnings": [
                "类别 0/1 的含义尚未获得确认；本分数不能解释为患病概率或诊断。",
                "已按提供的脚本进行音频预处理；发布权重的训练配置及特征顺序仍需作者核对。",
            ],
        }
