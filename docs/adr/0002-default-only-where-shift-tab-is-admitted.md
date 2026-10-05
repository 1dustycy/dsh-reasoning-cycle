# ADR-0002：只给承认 shift-only 手势的表面配默认键

## 状态

已采纳（2026-10-05）

## 背景

用户要的是 `Shift+Tab`。这是**只有 shift 一个修饰键**的组合，而快捷键注册表对它的态度
按表面分两种：

```js
function bindingIssue(binding, runtime, platform) {
  if (runtime === "desktop" && (platform === "windows" || platform === "macos")) return null;
  ...
  if (modifiers.length === 0 || modifiers.every((m) => m === "shift")) return "modifier-required";
  ...
}
```

对照 App 里实际加载的 `@deepseek-ai/dsh-client-shortcuts/lib/client.js` 跑出来的结果：

| 表面 | `Shift+Tab` | 为什么 |
| --- | --- | --- |
| `desktop:macos` / `desktop:windows` | ✅ 接受 | 前两行直接放行 |
| `desktop:linux` | ❌ `Reserved shortcut default` | 落到 `modifier-required` |
| `web:*` | ❌ `Unsupported Web shortcut` | 先被 `isWebBindingAllowed` 拦掉 |

而 `register()` 的校验是**加载期抛错**：

```js
if (candidate === void 0) continue;
const binding = normalizeBinding(candidate, platform);
if (runtime === "web" && !isWebBindingAllowed(binding, platform))
  throw new Error(`Unsupported Web shortcut: ${command.id}`);
if (bindingIssue(binding, runtime, platform) !== null)
  throw new Error(`Reserved shortcut default: ${command.id}`);
```

注意 `candidate === void 0` 那一行：**没有声明的默认键不会被校验**。也就是说，"某些表面不配键"
是注册表明确支持的形态，不是退让。

## 决定

**`defaults` 只声明 `desktop:macos` 与 `desktop:windows`；其余表面留空。**

命令本身仍然注册，因此 Web 与 Linux 桌面上这一行照常出现在「设置 → 快捷键」里，
只是显示为未绑定、由用户自己指派一个该表面允许的组合。

## 后果

**好处**

- 插件在任何表面都能加载，不会因为一个平台保留 `Shift+Tab` 就让整行挂掉。
- 没有在 Web 上抢 `Shift+Tab` —— 浏览器里它是反向焦点遍历，抢了会伤无障碍。

**代价**

- Web / Linux 用户开箱没有快捷键，得自己去设置里配。这是刻意的：能配和能生效是两件事，
  在这些表面上 `Shift+Tab` 本来就送不到页面。
- `test/registration.test.mjs` 必须同时锁住两侧：两个 desktop 表面接受、web 表面拒绝。
  只测"能注册"会漏掉将来把默认键加到 web 上的手滑。
