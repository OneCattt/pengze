# 传统扑克牌素材

- 来源：[Public Domain and CC0 Playing Cards](https://github.com/AustinGabriel/Public-Domain-and-CC0-Playing-Cards)
- 固定上游提交：`3765067c32fcef42a30e87022332db729658e7cd`
- 许可：CC0 1.0 Universal，全文见 `LICENSE-CC0.txt`。上游声明允许商用、修改与分发，无强制署名要求。
- `source/`：原始54张SVG，保留完整源文件，便于后续微信小游戏工程重新导出。
- `faces/`：240×336 WebP牌面，按原始5:7比例导出，质量88。
- `manifest.json`：逐张记录上游路径、本地文件、尺寸、体积及SHA256。

## 与游戏数据对应

`S/H/C/D`分别代表黑桃、红桃、梅花、方块，数字2至14对应2至A。例如`H13`为红桃K。`J15`使用黑王，表示小王；`J16`使用红王，表示大王。

两副牌复用54种图像，108张实体牌继续使用游戏各自的唯一ID。图片不参与牌型、主副牌、分数或结算判断。

页面为重叠手牌叠加清晰的点数、花色及大小王角标，角标背景覆盖至牌边，避免原始小角标残影。根据实际叠牌间距保留干净的窄栏，避免牌面花色挤入角标栏；末张、展开区及桌面仍显示完整牌面。保持原有“彭”字绿色牌背。构建时仅内嵌WebP，不将原始SVG打入HTML，不在线请求素材。

## 重新生成

需要Node.js、Sharp；首次获取源文件还需已登录的GitHub CLI。运行：

```sh
node verification/prepare-cards.cjs
node build.cjs
```

本地原始SVG存在时直接复用，不需要再次下载；日常构建已有图片仅需Node.js。
