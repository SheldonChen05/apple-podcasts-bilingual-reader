# Apple Podcasts 双语同步阅读器（Windows / Chrome）

## 安装
1. 解压 ZIP。
2. Chrome 地址栏打开 `chrome://extensions/`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择本文件夹 `apple_podcasts_bilingual_reader`。
5. 打开 Apple Podcasts 单集网页并播放。
6. 点击 Chrome 工具栏的扩展图标，再点击“打开双语阅读器”。
7. 阅读器会自动识别正在播放的单集，从 pod-text.com 获取 Apple 官方转录并用 AI 翻译。

## 自动获取转录
- 通过播放器的 Media Session 信息（单集标题、节目名）在 iTunes 目录中定位单集链接，再调用 pod-text.com 获取转录；切换单集时自动更新。
- 转录、翻译（按目标语言）、偏移都按单集缓存在本地。
- 若该单集 Apple 没有发布转录，或 pod-text.com 不可用，会在页面顶部提示。

## 翻译
- 在「翻译成」中选择目标语言：简体中文 / 日本語。从当前播放位置开始优先翻译。
- 默认免费、无需设置：使用 Chrome 内置的本地 AI（Chrome 138+，完全在本机运行，不上传内容）。
  - 优先用 Gemini Nano（Prompt API），结合前两段上下文翻译，更通顺；设备或语言不支持时自动改用 Chrome 内置翻译（Translator API）。
  - 首次使用需下载模型，页面会提示点击「下载并开始翻译」。
- 可选：在「自定义 AI 接口」填写任意兼容 OpenAI Chat Completions 的接口以获得更好的质量，例如：
  - OpenAI：`https://api.openai.com/v1`，模型 `gpt-4o-mini`
  - DeepSeek：`https://api.deepseek.com/v1`，模型 `deepseek-chat`
  - 通义千问：`https://dashscope.aliyuncs.com/compatible-mode/v1`，模型 `qwen-plus`
  保存时 Chrome 会请求访问该接口域名的权限。API Key 仅保存在本机扩展存储中。
- 每批最多 20 段一起翻译，并附带前 3 段原文与译文作为上下文，保证前后连贯；返回段数不对会自动重试/拆分。失败时点「重试翻译」只补译缺失部分。

## 同步校准
字幕时间 = Apple 播放时间 − 偏移。听到某句时点击该句右上角「对齐到此句」即可自动计算偏移；也可用滑块（±180 秒）、±1s/±5s 按钮或直接输入秒数微调，「重置」归零。偏移自动保存。

## 重要限制
- 请保持 Apple Podcasts 标签页打开并播放；Chrome 扩展读取页面中可访问的 `<audio>` 元素的 currentTime。
- 若 Apple 页面结构改变，扩展可能需要调整。
- 点击字幕目前只滚动到该句，不会控制 Apple 播放器 seek。
- 扩展声明的网站权限：`podcasts.apple.com`、`pod-text.com`、`itunes.apple.com`，以及你在 AI 设置中填写的接口域名（按需授权）；不读取账号或登录信息。单集标题和链接会发送给 iTunes 搜索与 pod-text.com，转录原文会发送给你配置的 AI 接口。
