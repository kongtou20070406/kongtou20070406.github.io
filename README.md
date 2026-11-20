# 空投 Kongtou 的个人网站

[访问网站](https://kongtou20070406.github.io/)

GitHub Pages 从 `main` 分支的根目录部署。编辑对应文件并提交到 `main` 即可更新网站。

- `index.html` 保存个人简介、项目和链接。
- `styles.css` 控制布局、字体和配色。
- `assets/` 存放封面、站点图标和字体。

本地预览时，在仓库目录运行 `python -m http.server 8000`，然后打开 `http://localhost:8000`。

## 黑洞与光路

封面和交互光路使用同一个 Schwarzschild 零测地线积分器 `light-rays.mjs`。取长度单位 `r_g = GM/c²`，在固定半径 `60 r_g` 处从观察者反向发射光线。由 `u = r_g/r` 和初始碰撞参数积分 `u″ = 3u² − u`，直到光线到达事件视界或逃向无穷远。光路图使用 `(r, φ)` 坐标绘制轨迹。

封面用 78° 倾角和从 `6 r_g` 延伸到 `34 r_g` 的理想化薄吸积盘。图像计算了引力偏折、引力红移和圆轨道物质的多普勒增亮。盘的发光纹理、色调及背景星场为示意模型。参考 [Gralla、Holz 和 Wald 的光线弯曲推导](https://arxiv.org/html/1906.00873#S2)和 [Luminet 的薄盘成像](https://articles.adsabs.harvard.edu/pdf/1979A%26A....75..228L)。

重新计算时可以运行 `node tools/render-black-hole.mjs black-hole.ppm`，再将生成的 PPM 图像转换为 `assets/black-hole.jpg`。
