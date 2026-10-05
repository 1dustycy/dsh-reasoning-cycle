# dsh-reasoning-cycle

[English](README.en.md) | 简体中文

按 `Shift+Tab` 把当前会话的推理等级往前推一档 —— 就像模型菜单里那一列档位被接上了一根拨轮。

等级环是**每次按键按当时的模型元数据现算的**：按模型目录里那一列声明等级走，最后一档的下一个绕回第一档。
只有当一个模型"不指定时会落到的那一档"**不**在它的声明列表里时，环首才多出一格真正的「提供方默认」。
换模型、换 provider、改等级，下一次按键就跟着变，插件里没有第二份档位表。

```
DeepSeek（defaultEffort = high，且 high 已声明）:  off → low → high → max → off → …
默认档不在声明列表里的模型:                        提供方默认 → off → low → high → max → 提供方默认 → …
```

为什么第一行不是 `提供方默认 → off → …`：那种写法会让「提供方默认」和 `high` 成为环上两个指向同一档的
相邻位置，`max` 下一步落在 `high`，此后再也走不出去 —— 用户看到的就是两档来回弹。推导见 ADR-0003。

## 它怎么工作

读 `ctx.modelDirectories` 里当前会话的模型选择，沿环取下一档，再用模型菜单同一条
`ModelDirectory.select` 落盘。也就是说：

- 等级落在**会话投影**里，和手动在菜单里点一档完全等价，刷新页面也还在；
- 插件不碰 Host 的 RPC 面，不自己发明档位名，也不缓存等级列表；
- 算出的下一档和当前档相同时（环只剩一格）不发 Select —— 那不是一步；
- 模型菜单正开着的时候不受影响 —— 菜单自己在 drilled pane 里用 `Shift+Tab` 返回上一层，
  它会先 `preventDefault`，这次按键就不再落到本插件（见 ADR-0001）。

## 哪些表面有默认键

| 表面 | `Shift+Tab` |
| --- | --- |
| dsh Desktop（macOS / Windows） | ✅ 开箱即用 |
| Web 页面 / Linux 桌面 | ⬜ 命令在，但**不配默认键**，需要自己在设置里指派 |

Web 与 Linux 上不配默认键是刻意的：浏览器里 `Shift+Tab` 是反向焦点遍历，注册表本身也会拒收
shift-only 的组合。命令仍然注册，所以「设置 → 快捷键」里那一行照常存在，可搜索、可改键、可解绑。

## 装进 profile

作为一个 bundle 挂进 `~/.dsh/profiles/<profile>/`：

```jsonc
// package.json
{
  "dependencies": {
    "dsh-reasoning-cycle": "link:/path/to/dsh-reasoning-cycle"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-reasoning-cycle"]
    }
  }
}
```

```bash
pnpm install
```

bundle 自带的 `cordis.patch.yml` 负责 mount 这一行（`ui-reasoning-cycle`），
**不要再往 profile 的 `cordis.patch.yml` 里 insert 一遍** —— 那只会多出一条空的 host 条目。

## 跑测试

```bash
npm test
```

三个套件：

- `test/client.test.mjs` —— 环的形状（含"提供方默认冗余时不留格"）、单步、**从 high 连按四次绕满一圈**、
  resolve/run 的副作用边界、失败路径。纯逻辑，无依赖。绕圈那条就是 ADR-0003 的回归测试：只断言环长什么样
  的测试挡不住那个 bug，因为当时的环"符合规格"——规格错了。
- `test/registration.test.mjs` —— 把 **App 里真实的快捷键注册表 bundle** 从已安装的
  `DeepSeek Harness.app` 里读出来跑：命令能注册、绑定解析成 `⇧ Tab`、手势能派发到这条命令，
  并且 web 表面确实会把同样的默认键**拒掉**（用来锁住 ADR-0002 的取舍）。
  没装 App 的机器上这个套件打一行 SKIP 后退出 0。
- `test/wiring.test.mjs` —— 按 DSH 的方式解析这条 bundle：profile 的 `dsh.profile.bundles`
  里有它、bundle 声明的 patch 文件存在、patch 恰好 mount 一行。没装进任何 profile 时打一行
  SKIP 后退出 0。要指向别的 profile 就设 `DSH_PROFILE_DIR`。

## 为什么要走快捷键注册表

因为 Desktop 壳里 DOM 的 `keydown` 派发被整个跳过了（`installKeyboard(..., native=true)`），
按键由 Electron 主进程按**已注册绑定表**匹配后才转发。自己在 window 上监听 `Shift+Tab`
在 Desktop 上一次都收不到。完整推导见 `docs/adr/0001-register-with-the-shortcut-registry.md`。
