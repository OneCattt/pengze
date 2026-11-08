from pathlib import Path
import re
import urllib.parse
import urllib.request

root = Path(__file__).resolve().parent.parent
sources = '\n'.join(path.read_text(encoding='utf-8') for path in (root / 'src').glob('*') if path.suffix in {'.html', '.js', '.css'})
characters = ''.join(sorted(set(re.findall(r'[\u3400-\u9fffA-Za-z0-9♠♥♣♦−＋·›×—▱◉…]', sources))))
asset_directory = root / 'assets'
asset_directory.mkdir(exist_ok=True)

for family, filename in [('Noto Serif SC', 'serif'), ('Noto Sans SC', 'sans')]:
    query = urllib.parse.urlencode({'family': family + ':wght@400..900', 'text': characters, 'display': 'swap'})
    request = urllib.request.Request('https://fonts.googleapis.com/css2?' + query, headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'})
    with urllib.request.urlopen(request, timeout=40) as response:
        stylesheet = response.read().decode('utf-8')
    urls = re.findall(r'url\((https://[^)]+)\)', stylesheet)
    if not urls:
        raise RuntimeError('未取得设计字体下载地址：' + family)
    with urllib.request.urlopen(urls[-1], timeout=40) as response:
        font = response.read()
    if font[:4] != b'wOF2':
        raise RuntimeError('字体下载内容不是WOFF2：' + family + '，签名' + repr(font[:4]))
    (asset_directory / (filename + '.woff2')).write_bytes(font)
    print(f'{family}：{len(font)}字节，已保存并供构建内嵌')
