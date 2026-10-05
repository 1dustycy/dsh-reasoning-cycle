# ADR-0003：提供方默认只在它不等于任何声明等级时才是独立的一环

## 状态

已采纳（2026-10-05）

## 背景

第一版把等级环写成 `[提供方默认, ...声明等级]`，理由是"提供方默认是一个真实可达的状态，
不是缺值"——模型目录里它确实是 `reasoningEffort` 字段缺席，所以它在环上占一格。

在真机上试的时候，DeepSeek 的模型是这样：

```
目录 defaultEffort: "high"
目录声明的等级: ["off","low","high","max"]
算出的环: ["(提供方默认)","off","low","high","max"]
```

**提供方默认那一格的落点就是 `high`。** 因为 `defaultEffort: "high"` 的含义是"不指定的话用
high"，所以选中"提供方默认"和选中 `high` 在会话里是同一个状态。环上于是有两个相邻位置指向
同一档：

```
… → max → 提供方默认(实际落在 high) → high → max → …
        └──────────── 这两格是同一档 ────────────┘
```

用户按 `Shift+Tab`，看到的就是 **high ↔ max 两档来回弹**，哪怕模型声明了四档。这不是
"菜单和插件不一致"，是插件把一个冗余档当成了独立位置。

## 决定

**环由 `(efforts, defaultEffort)` 共同决定：`defaultEffort` 已在 `efforts` 里时不生成
提供方默认那一格；不在时才生成。**

```js
function reasoningSteps(efforts, defaultEffort) {
  const declared = /* 取出合法 id */;
  if (declared.length === 0) return [{ effort: void 0 }];
  if (typeof defaultEffort === "string" && declared.includes(defaultEffort))
    return declared.map((effort) => ({ effort }));
  return [{ effort: void 0 }, ...declared.map((effort) => ({ effort }))];
}
```

顺带定死一条：算出的下一档等于当前档时（环只剩一格）**不发 Select**，它不是一步。

## 后果

**好处**

- DeepSeek 这类"默认档也是声明档"的模型，环就是它声明的四档，一圈走满。
- `xiaomi-token-plan-cn` 那种 `defaultEffort` 不在列表里的模型，仍然能回到真正"不指定"的状态。
- 这条判据来自模型目录自身的两个字段，不需要插件认识任何具体 provider 或档位名。

**代价**

- 环的形状取决于 `defaultEffort`，比"永远领一格"难一句话讲清；所以 `CONTEXT.md` 里
  「提供方默认」的定义必须带上这个条件，`reasoningSteps` 的文档注释也把这段推理写全。
- 模型菜单仍然同时列「提供方默认」和「High」两个看起来等价的行（UI 是上游的），
  快捷键这边的环会比菜单少一格。这是有意的：快捷键是轮流切换，重复的一格只会让人以为坏了。
- 回归测试从"环长什么样"升级成**绕一圈**（`test/client.test.mjs` 里从 `high` 连按四次
  依次得到 `max → off → low → high`）。只断言数组内容的测试挡不住这个 bug，因为它当时
  "符合规格"——规格本身错了。
