from pathlib import Path
import json
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent
reference = Image.open(root / 'references' / 'figma-bid.png').convert('RGB')
actual = Image.open(root / 'results' / 'bid-844.png').convert('RGB').resize(reference.size, Image.Resampling.LANCZOS)
positions = [(80, 60), (130, 80), (160, 150), (400, 150), (480, 210), (80, 210)]
samples = []
for position in positions:
    first = reference.getpixel(position)
    second = actual.getpixel(position)
    difference = max(abs(first[index] - second[index]) for index in range(3))
    samples.append({'position': position, 'figma': first, 'html': second, 'maxChannelDifference': difference})

# 回归重叠手牌的花色重影：角标下方的窄栏应保持浅色，不露出原始牌面的红黑图案。
corner_checks = []
for scene, count in [('bid', 25), ('bury', 33)]:
    hand = Image.open(root / 'results' / f'{scene}-844.png').convert('RGB')
    step = (644 - 52.5) / (count - 1)
    checked = 0
    for index in range(count - 1):
        top = 292 if scene == 'bury' and index < 3 else 310
        for dx in range(5, 14, 2):
            for dy in range(35, 44, 2):
                pixel = hand.getpixel((round(100 + index * step + dx), top + dy))
                if min(pixel) < 185 or max(pixel) - min(pixel) > 8:
                    raise AssertionError(f'手牌角标栏出现多余图案：{scene}，第{index + 1}张，{pixel}')
                checked += 1
    corner_checks.append({'cards': count, 'sampledPixels': checked, 'status': 'passed'})

comparison = Image.new('RGB', (reference.width * 2 + 18, reference.height + 30), '#eeeae2')
comparison.paste(reference, (0, 30))
comparison.paste(actual, (reference.width + 18, 30))
draw = ImageDraw.Draw(comparison)
draw.text((10, 9), 'Figma reference', fill='#35322d')
draw.text((reference.width + 28, 9), 'HTML / real 108-card data', fill='#35322d')
comparison.save(root / 'results' / 'figma-vs-html.png')
report = {'referenceNode': '2:7789', 'samples': samples, 'handCornerChecks': corner_checks, 'scope': '用户确认的江景茶室素材已替代旧Figma纯色桌布，采样与并排图仅作历史对照，不再要求桌布同色；保留25/33张手牌无图案重影检查，新场景布局和素材验证见scene-report.json。'}
(root / 'results' / 'visual-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'samples': len(samples), 'maxChannelDifference': max(sample['maxChannelDifference'] for sample in samples), 'handCornerChecks': corner_checks, 'status': 'passed'}, ensure_ascii=False))
