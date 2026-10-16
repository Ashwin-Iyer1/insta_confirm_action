"""Package runtime files only. No developer dependencies or test fixtures."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8-sig'))
files = ['manifest.json', 'core.js', 'content.js', 'index.html', 'popup.css', 'demo.html', 'demo.js', 'style.css', 'icon16.png', 'icon48.png', 'icon128.png']
target = root / 'dist' / f'instagram-action-guard-{manifest["version"]}.zip'
target.parent.mkdir(exist_ok=True)
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(root / name, name)
print(f'Packaged {len(files)} files: {target.name}')
