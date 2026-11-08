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
    if difference > 8:
        raise AssertionError(f'桌布采样与原型差异过大：{position}，{first} / {second}')
    samples.append({'position': position, 'figma': first, 'html': second, 'maxChannelDifference': difference})

comparison = Image.new('RGB', (reference.width * 2 + 18, reference.height + 30), '#eeeae2')
comparison.paste(reference, (0, 30))
comparison.paste(actual, (reference.width + 18, 30))
draw = ImageDraw.Draw(comparison)
draw.text((10, 9), 'Figma reference', fill='#35322d')
draw.text((reference.width + 28, 9), 'HTML / real 108-card data', fill='#35322d')
comparison.save(root / 'results' / 'figma-vs-html.png')
report = {'referenceNode': '2:7789', 'samples': samples, 'scope': '仅核对六个无遮挡桌布位置的颜色；布局、字体、操作条、选牌、结算和适配另行人工看图检查，不代表整页像素一致。'}
(root / 'results' / 'visual-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'samples': len(samples), 'maxChannelDifference': max(sample['maxChannelDifference'] for sample in samples), 'status': 'passed'}, ensure_ascii=False))
