# HiveWork 远程桌面壁纸

`hivework-tech.png` 是科技蓝背景的 HiveWork / 蜂巢智工壁纸。图片由内置 imagegen 工具生成，
参考现有远程桌面构图和 `../png/logo-bilingual-reverse.png`；左侧留出桌面图标空间，右下角放置品牌。

原始 PNG 为 1672×941；XFCE 按现有缩放规则显示，实际 1920×1080 桌面已通过截图验证。
文件 SHA-256：`7ca3d5da0d7f8b212cfbba985c9436a10198e6404382c1f787f08a085fb46a49`。

`scripts/prepare_platform_branding.py --generate-assets` 会将它复制到
`src/octop/infra/desktop/scripts/linux/v1.0/wallpaper.png`。保留原安装资源路径，
wheel 与新构建 Docker desktop 镜像继续通过现有安装步骤装载壁纸。
部署与在线缓存刷新记录见 `docs/deployment-1panel.md` 第 12 节。

## 最终生成提示词

输入 1：原版 `src/octop/infra/desktop/scripts/linux/v1.0/wallpaper.png`（本次替换前的版本）。
输入 2：`hivework-logo-assets/png/logo-bilingual-reverse.png`。
使用内置 imagegen，`transparent_background=false`；未调用 CLI/API 回退。

```text
Use case: compositing.
Asset type: production Linux remote-desktop wallpaper for HiveWork.
Input image 1 is the current 16:9 desktop wallpaper edit target. Image 2 is the existing HiveWork bilingual brand mark, supporting brand reference. Produce a polished replacement wallpaper at 1920x1080, exactly 16:9, opaque PNG.
Replace the entire old Octop visual identity with HiveWork. Use a clean dark navy/technology-blue backdrop, a restrained smooth blue glow on the right and faint large geometric honeycomb outlines. Most of the canvas, particularly the left quarter used for desktop icons, must stay calm, dark and low contrast. No photographic elements, no app icons, no interface frame.
In the lower right, with about 110px right margin and 120px bottom margin, place the supplied orange honeycomb H mark and crisp white wordmark "HiveWork", with "蜂巢智工" beneath it. Keep the mark geometry, English spelling and exact four Chinese characters accurate. Brand cluster width around 430px at 1920px canvas width, balanced and readable. Use the supporting logo as the identity, but remove any gray haze or backing rectangle around it. Preserve original brand orange. No Octop word or logo, no old slogan, no extra slogans, no URLs, no watermarks. This is a usable desktop background, restrained and consistent with a modern technology-blue application theme.
```
