from pathlib import Path
import hashlib
import json
import shutil

from PIL import Image


ROOT = Path(__file__).resolve().parent
INPUT_ROOT = Path('/var/folders/x8/g76f5p1n60v7vv7lg_3rv4280000gn/T')
SOURCES = {
    'player-left': '12def005-3ea9-46c3-9eec-9e3117c0ad30',
    'player-right': 'b732a505-5eef-4f13-a3c0-a114312861cd',
    'player-top': '3e22943f-6260-46d0-ad18-93090190f738',
    'table': 'ecea8fc1-0647-48fc-9c2d-a314796a9b1b',
    'room': 'e2760d16-9d47-41d3-ae8a-b74316615b11',
}


def main():
    source_root = ROOT / 'source'
    asset_root = ROOT / 'assets'
    source_root.mkdir(exist_ok=True)
    asset_root.mkdir(exist_ok=True)
    manifest = {}
    for name, identifier in SOURCES.items():
        original = source_root / f'{name}.png'
        if not original.exists():
            shutil.copyfile(INPUT_ROOT / f'codex-clipboard-{identifier}.png', original)
        image = Image.open(original)
        source_size = image.size
        crop = None
        alpha_range = None
        if 'A' in image.getbands():
            alpha = image.getchannel('A')
            alpha_range = alpha.getextrema()
            bounds = alpha.point(lambda value: 255 if value >= 16 else 0).getbbox()
            crop = (
                max(0, bounds[0] - 4), max(0, bounds[1] - 4),
                min(image.width, bounds[2] + 4), min(image.height, bounds[3] + 4),
            )
            image.putalpha(alpha.point(lambda value: 0 if value <= 8 else value))
            image = image.crop(crop)
        if name == 'room':
            image.save(asset_root / f'{name}.webp', quality=90, method=6)
        else:
            image.save(asset_root / f'{name}.webp', lossless=True, method=6)
        manifest[name] = {
            'source': f'source/{name}.png',
            'sourceSize': source_size,
            'sourceSha256': hashlib.sha256(original.read_bytes()).hexdigest(),
            'alphaRange': alpha_range,
            'crop': crop,
            'previewSize': image.size,
            'preview': f'assets/{name}.webp',
        }
    for name in ['serif', 'sans']:
        shutil.copyfile(ROOT.parent.parent / 'assets' / f'{name}.woff2', asset_root / f'{name}.woff2')
    (ROOT / 'asset-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
