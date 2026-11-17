# 包装盒动画独立测试页

本地入口：/box-scroll-test/
正式测试地址：https://tiny-strange-vis.pages.dev/box-scroll-test/

纯HTML/CSS/JS，无框架。沿用2026-11-17确认的动画与滚动曲线：
120 fps、1800张真实帧、15秒，默认1080p动态播放，4K自适应用于停留。
原始尺寸和原始裁剪坐标绘图，保留缓动与三个阅读停留。

此页拥有独立的HTML、样式、脚本和图片目录；首页五页及swarm.js无须改动。
网络版新增frame-packs-v1/、packed-frames.js、frame-source.js。1800张1080p WebP原字节封成30块，总计84.46MB，未重压。首帧优先显示，压缩素材全部准备后开放连续交互；首次访问有明确进度，再次访问复用浏览器压缩缓存。只解码附近帧，桌面256MiB、低内存设备128MiB，不会解码整套图片；4K仅停稳时准备。

部署须同步新增分块与脚本，并把根目录_headers同步到部署根目录。保留原frames_web_120fps_optimized/（首帧和4K仍依赖它）。由Block Bot按原main→Cloudflare Pages流程推送，Codex本次不提交或推送。
测试后若要放入正文，应再单独设计接入位置；当前阶段不改五页排版。
