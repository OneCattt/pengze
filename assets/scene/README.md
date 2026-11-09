# 江景茶室牌局素材

素材来自用户本次上传的茶室、牌桌及三位人物图片。原始PNG与裁切依据保存在 `designs/tea-room-layer-review/`；`manifest.json` 记录源文件指纹、输出尺寸和文件指纹。

运行 `node verification/prepare-scene.cjs` 生成适合当前844×390画板的WebP，再运行 `node build.cjs` 内嵌到独立HTML中。素材按约两倍显示尺寸导出，人物与牌桌保留透明通道。

页面复用固定的五张场景图，牌面、玩家信息、庄家状态、底牌和操作均由实际牌局生成。微信小游戏的资源打包及真机表现仍待正式工程验证。
