# 包装盒动画独立测试页

本地入口：/box-scroll-test/
正式测试地址：https://tiny-strange-vis.pages.dev/box-scroll-test/

纯HTML/CSS/JS，无框架和打包。沿用2026-11-17确认的稳定版播放器：
120 fps、1800张真实帧、15秒，默认1080p动态播放，4K自适应用于停留。
原始尺寸和原始裁剪坐标绘图，保留缓动与三个阅读停留。

此页拥有独立的HTML、样式、脚本和图片目录；首页五页及swarm.js无须改动。
部署时仅同步box-scroll-test文件夹到仓库根目录，然后由main触发Cloudflare Pages。
测试后若要放入正文，应再单独设计接入位置；当前阶段不改五页排版。
