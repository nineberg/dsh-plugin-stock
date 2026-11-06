# 投资标的 (`@local/dsh-astock-quotes`)

![License](https://img.shields.io/github/license/nineberg/dsh-plugin-stock) ![Platform](https://img.shields.io/badge/DeepSeek%20Harness-plugin-0969da) ![GitHub stars](https://img.shields.io/github/stars/nineberg/dsh-plugin-stock?style=social)

> 仓库：[nineberg/dsh-plugin-stock](https://github.com/nineberg/dsh-plugin-stock) · License: [MIT](LICENSE) © nineberg

DSH 插件：一个插件、两种形态、同一份数据——

- **侧栏面板**：左侧栏「投资标的」入口 + 中央面板，实时显示 A 股 / 港股 / 美股价格、涨跌幅与分时/5日走势，支持搜索增删标的（唯一编辑入口）。
- **悬浮窗**：把侧栏图标**拖出侧栏**即变灵动岛式悬浮窗（圆点 ⇄ 卡片弹性形变、可拖拽）；把悬浮窗（标题栏或圆点）**拖回侧栏**即停靠还原。
- **灵动岛打通**：悬浮球用原生拖放接入 `@local/plugin-island` 协议——把悬浮球**拖到插件灵动岛**上，悬浮球收进岛内（消失），灵动岛出现投资标的图标、点击可打开面板；拖侧栏图标到灵动岛同样有效。

## 结构

| 文件 | 作用 |
|---|---|
| `index.js` | Host 半：注册同源 JSON 接口 `GET /astock/quotes`（行情+分时+5日走势）与 `GET /astock/search`（标的搜索），向东方财富接口取数并缓存 |
| `client.js` | Client 半：注册侧栏入口（可拖出）、中央面板与悬浮窗（`shell.overlay`） |
| `cordis.patch.yml` | 安装时插入的插件行与默认标的配置 |
| `locale/*.json` | 插件管理页显示的名称与说明 |
| `icon.svg` | 插件管理页图标 |

## 交互

- **拖出（撕裂）**：按住左侧栏的趋势图标向外拖，松手即在落点弹出悬浮窗（带弹出动画）；点击仍是打开面板。
- **拖回（停靠）**：悬浮窗卡片按住标题栏拖到左侧导航栏松手即停靠回侧栏；悬浮球（收起态）直接原生拖拽，同样支持停靠、移位，以及拖到插件灵动岛停靠成岛内图标。
- **两态形变**：圆点 ⇄ 卡片是同一外壳元素，宽/高/圆角 700ms 长柔弹性曲线连续形变，内容层缩放+交叉淡入淡出。点按卡片左上角图标收起、点按圆点展开。
- **数据一致**：面板是唯一编辑面（搜索/新增/删除），悬浮窗只读并即时同步（`astock-quotes:changed` 事件 + storage 事件 + 1 秒轮询兜底）；分时/5日选择两边共享。
- **列表**：面板完整列表；悬浮窗默认显示 6 条、超出内部滚动，底部显示更新时间。

## 配置

`cordis.patch.yml` 中的 `config.symbols` 是初始（默认）标的列表，仅首次种子到 localStorage，之后的增删与形态/位置等状态都存本地。

```yaml
- insert:
    - id: astock-quotes
      name: '@local/dsh-astock-quotes'
      config:
        symbols:
          - sh600522   # 中天科技
          - sh688825   # 长鑫科技
          - sh600206   # 有研新材
          - sz000791   # 甘肃能源
          - sh000001   # 上证指数
        refreshMs: 8000
```

符号格式：A股 `sh600519` / `sz000791` / `bj430047`，港股 `hk00700`，美股 `us105:aapl`（数字为东方财富美股板块号）。

## 说明

- 浏览器只访问本机同源的 `/astock/*` 接口，不直连第三方，无 CORS 问题。
- 行情来源为东方财富公开接口，无密钥；报价缓存 3 秒、分时 60 秒、5 日线 3 分钟、搜索 60 秒。
- 涨为红、跌为绿（中国习惯）；系统开启“减少动态效果”时自动关闭形变动画。
- 悬浮窗与 `@local/plugin-island`（插件灵动岛）通过其 HTML5 拖放协议（`application/x-dsh-plugin-island`）互通。

## 安装到 DeepSeek Harness

```powershell
git clone https://github.com/nineberg/dsh-plugin-stock.git
# 将仓库目录作为 bundle 安装进 dsh profile（dsh plugin add <路径>），刷新 GUI 生效
```

配套组件：[插件灵动岛](https://github.com/nineberg/dsh-plugin-island) · [Obsidian 知识库记忆](https://github.com/nineberg/dsh-plugin-obsidian-memory)

## License

[MIT](LICENSE) © nineberg
