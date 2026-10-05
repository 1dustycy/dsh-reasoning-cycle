# ADR-0001：`Shift+Tab` 走快捷键注册表，不自己听 `keydown`

## 状态

已采纳（2026-10-05）

## 背景

这个插件要占一个**在输入框里打字时也要生效**的全局手势：`Shift+Tab`。手边有两条路。

**路一：自己监听。** `window.addEventListener("keydown", ...)` 里判 `event.shiftKey &&
event.code === "Tab"`，然后 `preventDefault()`。

**路二：交给 `ctx.shortcuts.register`。** 命令带 `defaults`、`regions`、`modals`、`resolve`，
由快捷键服务决定谁在什么时候收到这次按键。

在 Web 壳里两条路看着差不多；在 **Desktop 壳里差得很远**。Desktop 的 `installKeyboard`
是带 `native` 参数装的：

```js
installKeyboard(window, this.registry, (input) => { this.fixedInput(input) },
  keyboard !== void 0 && (this.platform === "macos" || this.platform === "windows"));
```

`native === true` 时，DOM 的 `keydown` 派发被整个跳过（`if (native) return`），
按键改由 Electron 主进程的 `before-input-event` 决定：

- 主进程按**已注册命令的绑定表**匹配（`keys.has(bindingKey({code, modifiers}))`）；
- 命中就 `event.preventDefault()`，再把归一化后的手势经 IPC 发给渲染进程；
- 渲染进程的 `installNativeKeyboard` 调 `registry.dispatch(...)`，命令才执行。

没有注册表里的绑定，主进程根本不认这个组合：它既不 `preventDefault`，也不转发。
自己监听的那份代码在 Desktop 上**一次都收不到** —— 至少收不到按下 Tab 的那次
（Tab 还会被 Chromium 当焦点遍历键吃掉）。反过来，注册表里的绑定在 Desktop 上
是**优先于 region 与 modal 闸门**的（`priority`），所以输入框里打字时它照样触发。

顺带三件事也只有走注册表才有：

1. 命令出现在「设置 → 快捷键」里，可改键、可解绑、可搜索；
2. 注册时按 runtime×platform 校验默认键，冲突/保留组合在**加载期**就报错，不是运行期失灵；
3. 弹层自己的 `preventDefault`（模型菜单在 drilled pane 里就用 `Shift+Tab` 返回上一层）
   会让 `dispatch` 提前 `pass`，插件无需知道菜单开没开。

## 决定

**`Shift+Tab` 通过 `ctx.shortcuts.register` 注册成命令 `model.reasoning.cycle`。**

- `defaults` 只给 `desktop:macos` 与 `desktop:windows`。
- `regions` 声明 `page` / `editable` / `terminal`，让 Web 与 Linux 桌面上的行为也说得通。
- 动作放在 `resolve` 返回的 `run` 里；`resolve` 本身只做判断，不产生副作用。

## 后果

**好处**

- Desktop 与 Web 都能生效，且 Desktop 上优先于输入框区域。
- 免掉了自建监听、焦点管理、弹层避让这三摊事。
- 改键、快捷键面板、加载期冲突检查都是白拿的。

**代价**

- 命令 id 进了产品命名空间。**若上游某天自带 `model.reasoning.cycle`，注册会抛
  `Duplicate shortcut command`**，插件当场失效。选这个 id 是因为它描述的是产品概念而不是本插件，
  真撞上时应当让位（改名为 `external.reasoning-cycle.*` 之类），而不是和上游抢。
- 注册表的默认键校验是**加载期抛错**：将来若某个平台把 shift-only 组合改成保留，
  这个插件会连带那个条目一起加载失败。`test/registration.test.mjs` 用 App 里真实的注册表
  跑这条校验，就是为了让这种变化在测试里先炸，而不是在用户机器上。
