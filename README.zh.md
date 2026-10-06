# dsh-plugin-skillhub-finder

[English](README.md) | 中文

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web 插件：在**输入框里、
模型选择器与发送键之间**放一个**圆形 SkillHub 按钮**。点一下，它读取你已经输入的内容，提取真正
带搜索意图的关键词，去 [skillhub.cn](https://skillhub.cn) 找能帮上这次工作的技能，把排好序的结果
显示在**右侧栏**，并支持一键安装。

> 这是**技能（skill）**查找器，不是 Cordis 插件商店。SkillHub 上分发的是 agent 技能——`SKILL.md`
> 技能包——所以这里的「下载」指的是*把技能装进你的 DSH 技能目录*，官方文件系统技能提供方会自动
> 发现它，无需重启。

## 长什么样

- **输入框里** —— 一个 28px 圆形按钮（`border-radius: 999px` + `corner-shape: round`，与官方
  `.add` 按钮同几何），颜色取自和邻居同一套 `--dsw-*` token。输入框为空时禁用，搜索中会旋转。
- **右侧栏里** —— 一个 `SkillHub 技能` 标签页，标签标题带实时结果数。`SkillHub 技能` 也会作为一张
  卡片出现在右侧栏的引导页上。

### 关于座位位置

输入框工具行把 `conversation.input.right` 渲染在模型选择器**之前**——`InputBar.tsx` 把它挂在
`.standardControls` 里、`conversation.input.model` 前面，停止/发送键在那组之后。而需求要的位置是模型
选择器*右侧*、发送键*左侧*，所以按钮声明了一个比模型座位更靠后的 flex 槽位：

```css
.skhf-btn { order: 2; }
```

这样它就落在要求的位置上，同时不去动别的插件的条目。模型选择器之后唯一可用的座位是
`conversation.input.activity`，但那个座位在这里是错的：它的占用者会横向展开并隐藏普通附属控件。

如果未来某个 DSH 版本按名字的字面顺序挂载这个座位，这条 `order` 就变成空操作，按钮依然紧贴模型选择器、
位于它和发送键之间。

## 安装

在本目录下用 `dsh plugin` 的路径形式：

```sh
dsh plugin --profile web add ./dsh-plugin-skillhub-finder
```

或者打包成 tarball 再装：

```sh
npm pack
dsh plugin --profile web add ./dsh-plugin-skillhub-finder-0.1.0.tgz
```

profile 名按你实际用的改（本项目在 `desktop` profile 上验证）。**Host 半的改动需要重启**；只改客户端
bundle 时刷新页面即可。

安装后 profile 里会多一行 Loader 配置：

```yaml
- insert:
    - id: dsh-plugin-skillhub-finder
      name: dsh-plugin-skillhub-finder
```

卸载同理：`dsh plugin --profile web remove dsh-plugin-skillhub-finder`。

## 使用

1. 写下你接下来要做的事——`帮我分析这份 Excel 并画图`、`帮我写周报`、`把这个 PDF 转成 Markdown`。
2. 点发送键左边那个圆形 SkillHub 按钮。
3. 右侧栏自动展开，顶部是提取出的关键词，下面是排好序的匹配结果。
4. **下载安装** 装技能；**卸载** 移除；**查看主页** 打开它在 skillhub.cn 的页面。
5. **把首个技能插入输入框** 把第一条推荐的名字写回输入框，方便你在下一条消息里引用它。

## 搜索是怎么做的

关键词提取跑在 **Host 端**，不在浏览器里：

- 中文候选词通过一张**功能字黑名单**把关：一个 2～4 字片段只有在不含任何代词、助词、
  能愿动词时才保留。这就是过滤掉「每句话都有的废话」的关键。**只靠停用短语表做不到**——
  跨两个词切出来的片段（`我想要`、`想要做`、`做一个`）得分反而高于旁边那个真正的术语，
  它们曾经是一个 SpringBoot 请求的 top 关键词。
- 术语按**权重**排序，不是按命中数量。人工维护的**主题词**（技术栈、产品、文件格式：
  `springboot`、`excel`、`pdf`、`mysql`）权重高于泛化的**意图词**（`分析`、`周报`、`框架`），
  意图词又高于统计 n-gram。所以 `我想要做一个springboot的后端框架` 会提取出 `springboot`
  和 `后端`，并且**丢掉 `框架`**——因为 `框架` 匹配到的是「思维框架」「记忆系统框架」。
- 英文单词用同样的方式把关，另减一份填充词表。

保留下来的关键词各自去查
`GET https://api.skillhub.cn/api/skills?keyword=…&sortBy=score`，结果按 slug 合并后
**按权重排序，而不是按命中分支数**。有两条证据规则：

- 只有当关键词**真的出现在**卡片的名称、slug 或简介里时，才算这个关键词的命中。
  `sortBy=score` 是模糊分词召回——`框架` 那个分支返回的股票分析、社媒报告里根本没有这个词。
- 名称命中权重高于简介命中。

某个关键词分支失败不会让整次搜索失败。当草稿里没有主题词（比如 `你好`）时，仍然会用整句去搜，
但快照会被标记为 `weak`，标签页会明说这是「按大意猜的」，而不是假装它是命中。

## 修改技能安装位置

安装根目录可以在运行时直接从标签页里改——不用改 profile，也不用重启：

1. 打开 **SkillHub 技能** 标签页。
2. 点当前路径旁的 **更改**，会打开客户端自带的文件夹选择器。
3. 选一个目录。Host 会先校验它、不存在就创建、确认可写，**然后才采用**。点 **恢复默认** 回到
   `$DSH_HOME/skills`。

所选路径在当前组合有设置服务时会通过 settings 文档持久化；Host 是**读取活的 Config** 的，所以新目录
对下一次安装立即生效。如果没有设置服务，目录仍在本次会话内生效，并且标签页会明说「未保存」，而不是
假装保存成功了。

## 配置

同一个值也可以一开始就写在 profile 的 `cordis.patch.yml` 里：

```yaml
- insert:
    - id: dsh-plugin-skillhub-finder
      name: dsh-plugin-skillhub-finder
      config:
        apiBase: https://api.skillhub.cn
        installDir: D:/skills
```

`apiBase` 必须是不带凭据的绝对 `http(s)` URL。`installDir` 在**插件加载时**和**每次变更时**都会校验：
相对路径（会相对于进程当前工作目录解析）和文件系统根目录都会被拒绝，`~` 会被展开。默认
`$DSH_HOME/skills`，即 `~/.dsh/skills`。

## 架构

两半，一个包。

**Host 半**（`lib/index.js`）在 `ctx.webServer` 上注册同源路由前缀 `/dsh-plugin-skillhub-finder/api`，
并独占所有文件系统写入：

| 路由 | 用途 |
|---|---|
| `POST /search` | 从草稿提取关键词（或接受显式传入），搜索、合并、标记已安装 |
| `GET /latest` | 最近一次结果快照，页面刷新后能恢复 |
| `GET /meta` | API 地址、安装目录及其默认值与可写性、分类中文名 |
| `GET /detail?slug=` | 单个技能的详情投影 |
| `POST /install-dir` | 校验、创建并采用新的技能根目录 |
| `POST /install` | 下载 zip 并解包到技能目录 |
| `POST /uninstall` | 移除已安装的技能 |

浏览器从不直连 `api.skillhub.cn`，因此没有跨域面，解压也发生在有文件系统的那一侧。

**客户端半**（`lib/client.js`）是手写的 lazy-CJS bundle——无打包器、无构建步骤：

- `conversation.input.right`（list、session 作用域）——圆形按钮。它通过标准 `useInput` prop 读草稿，
  不涉及任何编辑器接线。
- `sidebar.right.pane.tab` + `sidebar.right.pane.tab.title`（按标签类型 `id` 做 key）——结果页和它的
  实时标签标题。
- `ctx.sidebarRightTabs.register({ id, kind: 'skillhub-finder', title, guide })` 声明标签类型；
  `ctx.sidebarRight.openTab('skillhub-finder')` 打开并展开它。
- 每次客户端运行共享一个 store，把按钮和每个已挂载的标签页连起来，通过注册的 `inject` 面同时交给
  两边。
- 样式表是一个由 fiber 持有的普通 `<style data-plugin="dsh-plugin-skillhub-finder">` 标签，只用
  `--dsw-alias-*` / `--dsw-focus-ring-*` token。

### 安装是如何保证安全的

`POST /install` 是唯一的写路由，自带防护：同源 `Origin` 校验、8 KB 请求体上限、严格 slug 模式、
下载体积上限、ZIP 成员数上限，以及一条拒绝写出目标目录之外的解析后路径检查。成员只读取 stored 和
deflated 两种压缩方式，`..` 段和 `__MACOSX` 噪音会被丢弃，整棵树先在临时目录落地，再靠原子 rename
发布。同一个 slug 同时只允许一个安装在进行；第二次点击收到 `409`，不会去抢同一个目录。

## 开发

```sh
npm test        # node --test test/selfcheck.mjs
```

`test/selfcheck.mjs` 按 shell 的方式加载 `lib/client.js`——当成*普通脚本*，通过 `window.__ModuleLoader__`
门面——并断言：它以完全正确的包 id 注册、除基线 `react` 外不 require 任何模块、以正确的 id 和 order
注册三个座位、按钮与标签页共享同一个 store、每个 effect 都有 disposer。它同时检查 Host 半的配置
schema，以及每个 `exports` 条目都指向真实存在的文件。

没有构建步骤：直接改 `lib/client.js` 和 `lib/index.js`。客户端 bundle 是普通脚本，里面写 ESM 的
`import`/`export` 就是 `SyntaxError`——上面的测试会在 shell 报出难懂的 `did not activate` 之前先拦住它。

### 一个值得知道的失败模式

`apply()` 里任何地方抛异常都会让插件的**整个 fiber** 失败，而启动审计只报一行完全不带信息的话——
该条目的客户端状态就是字面上的 `failed`：

```
web boot: 1 entry did not activate
dsh-plugin-skillhub-finder: failed
```

它既不说哪个调用抛的，也不说错误是什么。本插件撞过一次：`sidebarRightTabs.register()` 内部会执行
`(definition.guide ?? []).map(...)`，所以把 `guide` 写成**对象**会抛
`TypeError: entries.map is not a function`，把整个插件拖下水——包括那些和 guide 毫无关系的部分。

因此 `test/selfcheck.mjs` 把 registry 自己的校验规则（guide 必须是数组、entry id 唯一、`title` 必须是
函数、id/kind 不能撞车）照搬成 `assertTabDefinition`，并由
`the tab type definition satisfies the registry contract` 断言。如果你扩展标签定义，请同步扩展这个镜像。

排查提示：两半都以包名作为各自的 entry id，所以客户端失败也会让 Host 路由 404——Host 半是好的，只是
它的条目从未挂载。另外 Host 侧改动永远需要重启，只有客户端 bundle 会热重载。

## 限制

- 结果排序基于 SkillHub 自己的搜索 score，最多六个关键词分支；没有语义重排，除 `命中` 标签外也没有
  逐条的「为什么匹配」解释。
- 结果快照存在内存加一个 Host 侧槽位里，所以刷新后只会恢复最近一次搜索。
- 安装只针对 `SKILL.md` 技能包。不是技能包的 SkillHub 条目会以 `this bundle has no SKILL.md` 被拒绝。
- 右侧栏标签页一次只渲染一页结果；还没有无限滚动或分类浏览——关键词标签和 `在 skillhub.cn 打开`
  链接是目前的出口。

## 许可

MIT
