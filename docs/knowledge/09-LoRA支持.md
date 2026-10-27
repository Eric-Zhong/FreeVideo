# 09 · LoRA 支持

> FreeVideo 支持 MiniMax H3 的社区 LoRA，并在量化（int8/FP8）权重上做“可融合 / 可在线流式”两种适配。本篇梳理其加载、校验与触发链路。

## 1. 模块清单

| 文件 | 角色 |
|---|---|
| `lora_names.py` | 规范张量命名（PEFT `lora_A/lora_B`、Kohya/diffusers `lora_down/lora_up`）；`supported()`、`adapter_keys()`；`INT8_UNMERGEABLE` 标记 int8 构建不可合并的 `adaln_proj` |
| `lora_check.py` | **仅头部校验**：只读键名 + 张量形状（不加载权重），对照固定 H3 `LAYOUT`（50 `transformer_blocks` + 2 `token_refiner.refiner_blocks`）；不适配时标 `UNUSABLE`。`MAX_HEADER_BYTES=64MiB` |
| `lora_triggers.py` | 按内容哈希的触发词；`apply_chain_triggers(record)` 在 `create/redo/set_text` 注入触发词到 block 文本；存 `lora-triggers.json` / `lora-fingerprints.json` |
| `lora_cache.py` | `prepare()` 构建**不可变 FP8 融合**适配器变体：反量化受影响矩阵→以输入 dtype 加 FP32 B@A 增量→同粒度重量化（`index_adapter`） |
| `lora_online_cache.py` | `prepare()` 构建小型**可流式**适配器因子（置于未变 FP8 权重旁），产出 `online_lora` manifest（逐 block 规格 + `root`，带 `cache_hit` 快路径） |
| `lora_online.py` | `attach_block()` 安装独立低秩分支，其缓冲跟随层 offloader，并 monkey-patch `module.forward` 应用 LoRA，无需第二个完整输出矩阵 |
| `lora_kernels.py` | Triton `_up_add` 内核：上投影 + 原地 add |

## 2. 集成链路

```mermaid
flowchart LR
    A[comfy_nodes 解析名称<br/>comfy_assets.resolve_loras] --> B[lora_check 头部校验<br/>UNUSABLE?]
    B --> C[lora_cache / lora_online_cache<br/>构建 FP8 融合 或 在线流式]
    C --> D[runtime.Engine 读 online_lora manifest]
    D --> E[lora_online.attach_block<br/>按 transformer block 挂载]
    E --> F[worker 报告 lora=bool(manifest)]
```

- **名称解析**：`comfy_nodes.py` 经 `comfy_assets.resolve_loras` 解析 LoRA 名。
- **头部校验**：`lora_check` 仅读键名与形状，避免加载整个权重即可判定是否适配固定 H3 布局。
- **缓存准备**：二选一——`lora_cache` 的 **FP8 融合**（把 LoRA 增量并入 FP8 权重，省一次输出矩阵）或 `lora_online_cache` 的 **在线流式**（小因子随权重按需加载，跟随层 offloader）。
- **生成时挂载**：`runtime.Engine` 读 `online_lora` manifest，`lora_online.attach_block` 在每 transformer block 安装低秩分支；`worker.py` 报告是否启用了 LoRA。
- **MPS 端**：`backends/mps_weights.py` 做同样的挂载（Apple Silicon 路径）。

## 3. 触发词

`lora_triggers.py` 用内容哈希管理用户触发词，在链创建/重做/改文本时自动注入到 block 文本，确保 LoRA 被正确激活。

## 4. 设计要点

- **不加载全权重即可校验**：头部只读，降低错误 LoRA 的代价。
- **两种量化适配路径**：融合（省算力） vs 在线流式（省显存/支持更大 LoRA），按场景选择。
- **跟随 offloader**：LoRA 分支缓冲跟随主模型的分层 offload，保证低显存下仍可用。
