# mulby-cli 发布指南

本文档介绍如何将 `mulby-cli` 发布到 NPM 仓库。

## 1. 准备工作

已为你配置好了 `package.json`，确保包含了 `files` 字段以正确发布 `dist` 和 `assets` 目录。

确保你已在终端登录 NPM：

```bash
npm login
```

## 2. 构建项目

在发布前必须构建 TypeScript 代码：

```bash
cd packages/mulby-cli
npm run build
```

确保 `dist` 目录已生成且包含编译后的文件的。

## 3. 发布

执行发布命令：

```bash
# 如果是第一次发布或普通发布
npm publish --access public

# 如果是测试版本
npm publish --tag beta --access public
```

> 注意：`--access public` 是为了确保包是公开的（对于 scoped package 如 `@my/pkg` 尤为重要，`mulby-cli` 虽为非 scoped 包，加上参数是个好习惯）。

## 4. 验证

发布成功后，可以通过以下命令验证：

```bash
npm info mulby-cli version
```

或者尝试安装：

```bash
npm install -g mulby-cli
```
