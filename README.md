# 拾页 · PAGE TUTOR

把一份 PDF / Word / PPT 变成一关可以「聊着学」的课程：AI 拆出全部知识点，一段一段讲解，讲完就出选择题、填空题，答完继续下一段。每一份资料在书架上变成一本书，随时可以回来翻聊天记录。

`MIT License` · 纯前端无后端 · 资料只在本地解析 · 只内置境内服务商

![书架](preview-study-shelf.png)

![关卡内页](preview-study-level.png)

![设置](preview-study-settings.png)

---

## 怎么跑起来

**方式一：直接双击 `index.html`**
浏览器直连 DeepSeek 接口。实测 CORS 是通的，一般能直接用。缺点是密钥存在浏览器里。

**方式二：双击 `start.bat`（推荐）**
会启动一个本地小服务 `http://127.0.0.1:8765`，页面和 API 请求都走本地，不存在跨域问题，也不会把 Key 暴露给第三方。需要装过 Python 3.8+。
Mac / Linux 用户没有 `start.bat`，直接 `python3 server.py` 即可。

> 这个文件夹是**完全可移植**的：换台电脑、换个目录、换个浏览器都能直接跑。
> 唯一跟着环境走的是三样东西——书架数据（各自的浏览器本地）、API Key（各自填）、本地代理（各自可选）。

#### 关于这个本地地址

`127.0.0.1` 是**回环地址**，永远指向“运行页面的这台电脑自己”。所以：

- 每台电脑的地址都是 `http://127.0.0.1:8765`，但连的是各自的机器的服务
- 没启动 `server.py` 的电脑打开它会显示“无法访问此网站”——因为那台机器上没有人在监听
- 端口默认 8765，可用环境变量改：`set PORT=8799` 后启动，同时把页面里的「代理地址」改成 `http://127.0.0.1:8799`
- 端口被占用时脚本会提示换端口

**同学一般用不到它**：浏览器直连 API 是通的（实测过），`server.py` 只是跨域被拦时的兜底。
另外，如果页面是从 **https 网址**打开的（比如 GitHub Pages），浏览器会限制页面访问 `http://127.0.0.1`，
这种情况下请用直连，别开代理。

```
python server.py            # 或者双击 start.bat
```

如果想让代理服务器替你保存 Key：

```bat
set DEEPSEEK_API_KEY=sk-xxxxxxxx
python server.py
```

---

## 第一次使用

1. 点右上角「设置」
2. **服务商预设** 选一个（不想花钱就选智谱 GLM-4-Flash / 腾讯混元 lite / 讯飞星火 Lite）
3. 填 **API Key**，点「测试连接」确认通了
4. 保存，回到首页把文件拖进虚线框 → 选参数 → 开始生成

想先不花钱试试效果：设置里勾上 **演示模式**，或者首页空书架上的「先看一个示例关卡」。

---

## 支持的文件

| 类型 | 说明 |
|---|---|
| `.pdf` | 用 pdf.js 在本地解析。**扫描版（纯图片）读不出文字**，需要先用 OCR 转一遍 |
| `.docx` | mammoth 解析。旧版 `.doc` 请先另存为 `.docx` |
| `.pptx` | 解压后逐页读文本框。旧版 `.ppt` 请先另存为 `.pptx` |
| `.txt` / `.md` | 直接读 |

解析库走 CDN（jsDelivr，失败自动切 unpkg），第一次使用需要联网。

---

## 生成一关要花多久

流程是三步，全部串行调用模型：

1. **切块提取知识点**：每 ~2800 字一次调用
2. **整理教学大纲**：把知识点去重、排顺序、分成若干小节
3. **逐小节写讲解 + 出题**：每节一次调用

一本 20 页的讲义大概 6~10 次调用、1~2 分钟。进度条和日志会实时显示每一步。

因为要「覆盖所有知识点」，长文档的调用次数会线性增长；代码里做了上限保护（最多切 34 段）。

---

## 数据存在哪

全部在浏览器 `localStorage` 里：`pt.index.v1`（书架索引）、`pt.level.<id>`（每个关卡）、`pt.settings.v1`（设置）。

- 资料原文**不会**上传到任何服务器，只有切块后的文本会发给 DeepSeek
- 换浏览器 / 清缓存会丢，重要的话自己留意
- 书架上的书悬停时右上角有删除按钮

---

## 文件结构

```
study/
├── index.html   页面结构
├── style.css    样式（纸张 / 墨 / 印刷网点质感）
├── app.js       解析、模型调用、生成流程、聊天回放
├── server.py    可选的本地代理（标准库，无依赖）
├── start.bat    一键启动
└── preview-study-*.png
```

---

## 分享给同学 / 传到 GitHub

这个 `study/` 目录本身就是完整项目，不依赖工作区里的其他东西，可以直接当仓库根目录。

```bash
cd study
git init
git add .
git commit -m "feat: 资料转学习关卡"
git branch -M main
git remote add origin https://github.com/<你的账号>/page-tutor.git
git push -u origin main
```

**用 GitHub Pages 发布**：Settings → Pages → Source 选 `Deploy from a branch` → `main` / `(root)` → Save。
一两分钟后地址是 `https://<账号>.github.io/page-tutor/`，同学点开就能用。

**同学的使用流程**：打开网址 → 设置里选一家免费服务商（智谱 / 混元 / 星火）→ 填**他自己**的 Key。
数据存在各自的浏览器里，互不影响，也不需要你做任何后端。

### ⚠️ 三件不能做的事

1. **别把 Key 提交进仓库**。本项目 Key 只存在浏览器 localStorage，代码里没有任何密钥，`.gitignore` 也挡了 `*key*.txt`。
2. **别做「共用 Key」的服务器版本**。那样额度几分钟被刷完，还可能违反服务商条款导致封号；让每个人填自己的 Key 最稳。
3. **别在工作区根目录 `git init`**，否则会把 `myosotis` 等无关项目一起推上去。只推 `study/` 即可。

### 如果 github.io 打不开

- **Gitee Pages**：需要实名认证 + 仓库公开，国内访问快
- **腾讯云 / 阿里云静态网站托管**：免费额度够用
- **直接发文件夹**：把 `study/` 打包发给同学，双击 `index.html` 一样能用

解析库（pdf.js / mammoth / jszip）按 `jsDelivr → npmmirror 国内镜像 → unpkg` 的顺序自动切换，
每个源 9 秒超时，所以校园网下也能加载出来。

---

## 想不花钱：可以，但别用网页版

**DeepSeek 网页版（chat.deepseek.com）不能被程序调用。** 它需要登录态、有 PoW 验证，自动化属于违反服务条款，社区里的同类工具都明确警告会导致账号限流甚至封禁。省几毛钱不值得。

> 本项目只内置**境内服务商**，不提供任何境外模型通道（OpenRouter、Gemini、Ollama 等已移除）。

正路是换一个**免费的国内 API**。设置里已经内置了预设，选好、点「测试连接」、通过就保存：

| 预设 | 免费情况 | 申请地址 |
|---|---|---|
| **智谱 GLM-4-Flash** ⭐ | 免费，中文好，当主力够用 | open.bigmodel.cn |
| **腾讯混元 hunyuan-lite** | 免费 | cloud.tencent.com/product/hunyuan |
| **讯飞星火 Lite** | 免费（Key 用 APIPassword） | xfyun.cn |
| **阿里云百炼** | 新用户每个模型送 100 万 tokens | bailian.console.aliyun.com |
| **硅基流动** | 赠送额度 + 部分模型免费 | cloud.siliconflow.cn |
| **DeepSeek 官方** | 按量计费，极便宜 | platform.deepseek.com |

注意：
- 各家免费模型清单会变，报错就去控制台看当前哪些标着「免费」
- 免费模型普遍是轻量版，生成结构化 JSON 时偶尔会格式跑偏，代码里已经做了容错解析；
  如果某一份资料反复失败，换 DeepSeek 官方或百炼上的大模型会更稳
- 阿里云百炼的 base_url 按地域区分，国内用 `https://dashscope.aliyuncs.com/compatible-mode/v1`

如果只是想先看看效果，设置里的 **演示模式** 完全不调用 API。

---

## 想换个付费模型

设置里的 **Base URL** 和 **模型** 都可以改，预设选「自定义」手动填即可。只要兼容 OpenAI 格式就能用。

---

## 已知限制

- 扫描版 PDF 不支持（没有 OCR）
- 生成过程中关掉页面会中断，已生成的部分不会保存
- 题目判分：选择题按选项下标；填空题做了去空格 / 标点 / 大小写的模糊匹配，答案过长时可能误判，可在解析里自己核对
- 单个关卡存在 localStorage，特别长的文档（几百页）可能撑爆配额

---

## License

[MIT](LICENSE)。随便用、随便改、随便分发，保留版权声明即可。
