"""IMPALA-CNN features extractor for SB3.

Mirrors the architecture used in the OpenAI ProcGen paper
(`baselines.common.models.build_impala_cnn`, depths=[16,32,32], emb_size=256)
and the Torchbeast/R2AC ProcGen reference. This is the canonical ProcGen
vision stem; SB3's default NatureCNN is materially worse on procedural
benchmarks and is not paper-comparable.
"""

from __future__ import annotations

import gymnasium as gym
import torch
from stable_baselines3.common.torch_layers import BaseFeaturesExtractor
from torch import nn
from torch.nn import functional as F


class _ResidualBlock(nn.Module):
    """Two-conv residual block (ReLU -> Conv -> ReLU -> Conv) + skip add."""

    def __init__(self, channels: int) -> None:
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, kernel_size=3, stride=1, padding=1)
        self.conv2 = nn.Conv2d(channels, channels, kernel_size=3, stride=1, padding=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = F.relu(x)
        h = self.conv1(h)
        h = F.relu(h)
        h = self.conv2(h)
        return x + h


class _ImpalaStage(nn.Module):
    """Conv -> MaxPool -> 2x ResidualBlock — one IMPALA stage."""

    def __init__(self, in_channels: int, out_channels: int) -> None:
        super().__init__()
        self.conv = nn.Conv2d(in_channels, out_channels, kernel_size=3, stride=1, padding=1)
        self.pool = nn.MaxPool2d(kernel_size=3, stride=2, padding=1)
        self.res1 = _ResidualBlock(out_channels)
        self.res2 = _ResidualBlock(out_channels)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.conv(x)
        x = self.pool(x)
        x = self.res1(x)
        x = self.res2(x)
        return x


class ImpalaCNN(BaseFeaturesExtractor):
    """ProcGen-canonical vision stem: 3 IMPALA stages [16, 32, 32] -> FC(256).

    Input expected as (B, C, H, W) uint8 in [0, 255]. Stems on 64x64x3 images
    by default; works for any input as long as conv arithmetic stays positive.
    """

    def __init__(
        self,
        observation_space: gym.spaces.Box,
        features_dim: int = 256,
        depths: tuple[int, ...] = (16, 32, 32),
    ) -> None:
        super().__init__(observation_space, features_dim=features_dim)
        in_channels = observation_space.shape[0]

        stages = []
        c = in_channels
        for depth in depths:
            stages.append(_ImpalaStage(c, depth))
            c = depth
        self.stages = nn.Sequential(*stages)

        # Compute flattened conv-output size by a single dry-run pass
        with torch.no_grad():
            dummy = torch.zeros(1, *observation_space.shape, dtype=torch.float32)
            flat = self.stages(dummy).flatten(1).shape[1]
        self.fc = nn.Linear(flat, features_dim)

    def forward(self, observations: torch.Tensor) -> torch.Tensor:
        x = observations.float() / 255.0
        x = self.stages(x)
        x = F.relu(x)
        x = x.flatten(1)
        x = F.relu(self.fc(x))
        return x


def impala_policy_kwargs(features_dim: int = 256) -> dict:
    """policy_kwargs payload to wire ImpalaCNN into PPO/DQN."""
    return {
        "features_extractor_class": ImpalaCNN,
        "features_extractor_kwargs": {"features_dim": features_dim},
    }
