# git-viewer

轻量 web 版只读 Git 查看器。日常只想看看改了啥、最近提交历史、本地/远程分支状态？开浏览器就好，不用启 VSCode。

## 使用

```bash
npm run install:all    # 首次安装依赖
npm run dev            # 启动前后端
```

浏览器打开 http://localhost:5173 （Vite 默认端口；后端默认 5174）。

## 配置

编辑根目录 `config.json`，把常用仓库加进 `repos` 列表：

```json
{
  "port": 5174,
  "repos": [
    { "name": "my-project", "path": "D:/code/my-project" },
    { "name": "another",    "path": "D:/code/another" }
  ]
}
```

`path` 用正斜杠，绝对路径。

## 功能

- [x] 查看工作区改动（M/A/D/U/?）
- [x] 查看提交历史（图谱 + 分支标签）
- [x] 本地 + 远程分支切换与过滤
- [x] 查看文件 diff
- [x] 查看历史 commit 的改动
- [ ] （暂不支持写入：commit / push / checkout）
