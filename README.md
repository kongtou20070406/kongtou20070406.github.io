# 空投 Kongtou 的个人网站

[访问网站](https://kongtou20070406.github.io/)

GitHub Pages 从 `main` 分支的根目录部署。纯 HTML、CSS 和一个 JavaScript 模块，没有构建步骤；编辑后提交到 `main` 即可更新。

- `index.html`：全部文字内容（简介、研究、项目、做法）。
- `styles.css`：排版与配色。亮色和暗色两套配色都定义在 `:root`，跟随系统设置切换。
- `recurrence.mjs`：首屏的图 1，同步邻域递推的实时演示。
- `assets/`：标题字体子集、图标、分享图和字体许可证。
- `tools/build_assets.py`：生成 `assets/` 里的字体子集、图标和分享图。

本地预览时，在仓库目录运行 `python -m http.server 8000`，然后打开 `http://localhost:8000`。

## 图 1：同步邻域递推

图 1 在浏览器里实时迭代一个标量递推

```
x_{t+1} = λ · Ā x_t + b,   x_0 = b,   λ = 0.95
```

`Ā` 把每个格子和它上下左右四个邻居取平均（网格外按 0 计），`b` 在源点处为 1。`Ā` 非负且每行和不超过 1，所以 `‖x_{t+1} − x_t‖∞ ≤ λ‖x_t − x_{t−1}‖∞`：这一步是收缩映射，迭代收敛到唯一不动点 `(I − λĀ)⁻¹ b`。信息每轮走一格，第 `T` 轮时非零的格子恰好是离源点曼哈顿距离不超过 `T` 的格子。圆点大小按对数刻度覆盖 6 个数量级。`λ = 0.95` 取自 NSI 的增益上界；这是简化的标量版本，不是 NSI 本身。

## 改了标题文字之后

标题、印章和引语用 Noto Serif SC 的子集（约 110 KiB，只含页面用到的字）。改动这些位置的文字后，重新生成子集，否则新字会退回系统字体：

```
python tools/build_assets.py --font C:/Windows/Fonts/NotoSerifSC-VF.ttf
```

脚本需要 fontTools、brotli、Pillow 和 numpy，会同时重画 `seal.svg`、`seal-180.png` 和 `og.png`。Noto Serif SC 以 SIL Open Font License 1.1 发布，许可证见 `assets/NotoSerifSC-OFL.txt`。
