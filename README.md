# kongtou

[kongtou20070406.github.io](https://kongtou20070406.github.io/)

一扇蓝调时刻起雾的窗。手指在雾上写下 `kongtou`，雾慢慢回来盖住它，下一次重写的笔迹会不一样；按住画面或按空格是哈气，以前写过的字会从雾里浮出来。窗台上的猫背对着你看雪，它的脸在玻璃的反光里。天色跟着访客本地的时间变。往下是 notes。

纯静态页面，无构建步骤：

- `glass.mjs`：WebGL2 渲染。窗外照片加实时落雪和星空；雾的模拟（密度与手指留下的油迹）；水的模拟（凝结、合并、下滑、尾迹）与按水滴高度场计算的折射、反射和高光；玻璃里映出的房间（显示器上的循环和 loss 曲线、按访客时间倒着走的钟）；窗台与猫。
- `notes.mjs`：博客。文章是 `posts/` 里的 Markdown 文件，在 `posts/index.json` 里登记；越早的文章越模糊。
- `assets/`：窗外画面、房间、猫（油画）、字体子集（Noto Serif SC，SIL OFL 1.1，见 `assets/NotoSerifSC-OFL.txt`）。

调试开关：`?hour=23` 预览某个时刻；`?demo` 自动擦几道；`?water` 把水涂成红色。

本地预览：`python -m http.server 8000`，打开 `http://localhost:8000`。
