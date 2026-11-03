# Local patches（本仓 = 更新源，不再跟随上游）

本仓库是 zhu1090093659/dsh-web 的 fork（devzer0o0/dsh-web）。
本机 DSH 桌面 profile 里的 @linxin666/dsh-remote-web-ui 已指向本 checkout：

    ~/.dsh/profiles/desktop/package.json
      "@linxin666/dsh-remote-web-ui": "link:/Users/space/IdeaProjects/会话/dsh-web-fork/packages/dsh-remote-web-ui"

因此页面上跑的就是这里的 lib/client.js，升级只来自本仓：profile 里不再保留任何
registry 版本号，市场对 link: 依赖一律读作 linked、永不提示在线更新
（dshmarket/lib/updates.js 的 link: 分支）。也没有配置 upstream remote，
git pull 只拉 origin（本 fork）。

## 本仓相对上游的改动

### 1. 电话图标移到侧边栏右下角

文件：packages/dsh-remote-web-ui/src/client/remote.module.css（文件末尾追加）

    :global([data-dsh-frame]:not([data-sidebar-collapsed])) [class*='footArea'] { position: relative }

    :global([data-dsh-frame]:not([data-sidebar-collapsed])) [class*='footArea']
      [class*='entryRow']:not([data-rail]) {
      position: absolute; right: 0; bottom: 2px;
      z-index: 6; flex: none; order: 0; margin: 0;
    }

只匹配宽侧边栏（不带 data-rail）；56px 窄条仍走文件里原有的竖排 rail 规则。

## 改完怎么跑

    cd /Users/space/IdeaProjects/会话/dsh-web-fork
    node scripts/install-deps.mjs                                  # 首次/依赖变动时
    cd packages/dsh-remote-web-ui && ./node_modules/.bin/tsdown    # 产出 lib/client.js

宿主有客户端 bundle 轮询（client-hmr，默认 500ms），改完刷新一次页面即可看到。

## 更新流程（只从本仓）

    cd /Users/space/IdeaProjects/会话/dsh-web-fork
    git pull origin dev
    node scripts/install-deps.mjs
    cd packages/dsh-remote-web-ui && ./node_modules/.bin/tsdown

如需从上游取更新，手动 git remote add upstream <url> 再合；默认不配。
