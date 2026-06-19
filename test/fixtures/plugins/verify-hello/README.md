# verify-hello（验证夹具插件）

这是 Mulby 插件验证 harness 的最小测试夹具，**不是**随应用打包的内置插件
（位于 `test/`，不进入 electron-builder 的产物）。

它是一个纯静默插件：

- 一个功能 `echo`，关键词触发 `vhello`，`mode: silent`，无 UI；
- `main.js` 导出 `onLoad` 与 `run`，分别在加载与触发时打印日志。

用于端到端验证「加载 → onLoad → 触发匹配 → 执行」链路：

```bash
pnpm build:bundle
pnpm verify:plugin test/fixtures/plugins/verify-hello
```

预期所有检查项通过（onLoad、触发匹配、执行均为 ✓）。

详见 `docs/plugin-verify.md`。
