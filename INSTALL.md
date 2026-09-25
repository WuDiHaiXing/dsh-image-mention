# dsh-image-mention — 安装与使用

把刚上传的图片**带序号和文件名 `@` 进对话**，让模型分得清你说的是哪一张；
**点击引用块**可以全屏预览那张原图。

- 纯浏览器侧插件：宿主半边是空壳，不注入任何平台服务
- **零 npm 依赖**（只用客户端已提供的 react），装完不用联网
- bundle patch 只有一条 `insert`，行 id = 包名 = `dsh-image-mention`（构造上撞不了车）
- 能力面：不读文件、不联网、不执行命令、不碰凭据

## 用起来

1. 把图拖进输入框（或点 `+` 上传）—— 上传区出现缩略图
2. 输入框里打 **`@`** —— 菜单多出一组「本轮图片」：缩略图 + 文件名 + 尺寸
3. 选中一张 → 输入框出现引用块 `图 Q版.png`
4. 发送 → 模型收到 `【本条消息第 2 张图："Q版.png"】`
5. **点那个引用块** → 全屏预览原图（点空白或 Esc 关闭）

### 一条平台硬规则（不是本插件的限制）

`@` 必须落在**行首**或**空白之后**。`aa@`、`你好@`、`）@` 都**不会**弹菜单 ——
平台自带的 `@文件` / `@会话` 走同一条检测路径，一样如此。
要引用第二张时，`@` 前面**留一个空格**。

## 装法 A：真装（推荐）

```bash
dsh plugin --profile <你的 profile> add file:<这个目录的绝对路径>
# 或从 GitHub 装：
dsh plugin --profile <你的 profile> add github:<你的账号>/<仓库名>
```

命令会把包名写进该 profile `package.json` 的 `dsh.profile.bundles`（若没有，
手工把它加进那个数组）。装完**重启 DSH**，或者按 Ctrl+R 刷新页面。

## 装法 B：零安装热挂载（试用/开发）

不改任何包，只在 `<profileDir>/cordis.patch.yml` 末尾追加三行：

```yaml
- insert:
    - id: dsh-image-mention
      name: '<这个目录的绝对路径>/lib/index.js'
```

保存后刷新页面即生效（profile HMR）。**回滚 = 删掉这三行。**

> ⚠️ 改完 `cordis.patch.yml` / `package.json` 之后，**浏览器一定要 Ctrl+R 一次**。
> 宿主会重播客户端插件清单，客户端插件作用域被重挂，**其它**客户端插件挂在 `document.head`
> 的样式会被它们的卸载钩子清掉（典型症状：表情包面板塌成一列挤在输入框左上角）。
> 刷新即愈，与本插件无关。

## 兼容性与降级

- 目标环境：DSH **0.1.7-rc.2** 发布版（Web）
- 依赖的公开客户端契约：`inputTriggers.registerSource`、`conversation.input.*` 草稿快照
- `conversation.resolveDraftAttachments` 与其中的 `previewUrl` **不在公开类型面**里，
  插件对它们做了 `typeof === 'function'` 守卫 + try/catch：
  拿不到就优雅退化 —— **照旧能 `@`**，只是点引用块不弹预览
- 图片序号来自浏览器侧草稿快照。提交路径会在序列化**之前**清空 `attachmentIds`，
  所以插件自己缓存「最后一次非空列表」，否则发送后点引用块会失效

## 卸载

- 装法 A：`dsh plugin --profile <profile> remove dsh-image-mention`，
  并从该 profile `package.json` 的 `dsh.profile.bundles` 里去掉那一条
- 装法 B：删掉那三行

MIT
