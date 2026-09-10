"""Convert the pinned Rocketbox TGA assets into browser image formats.

Texture atlases are reduced from 2K to 1K for the gameplay camera, vertically
flipped for the FBX-to-glTF texture convention, and normal green channels are
converted for glTF's tangent convention. RGB color maps use JPEG; normal maps
and hair alpha use lossless PNG after resampling.
Run with a Python environment containing Pillow, from the game directory.
"""
from pathlib import Path
from PIL import Image, ImageOps

source = Path('../research/raw/rocketbox')
target = Path('public/assets/civilian')
target.mkdir(parents=True, exist_ok=True)
def gameplay_size(image):
    return image.resize((1024, 1024), Image.Resampling.LANCZOS).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
def save(image, filename, **options):
    file = target / filename
    temporary = file.with_name(file.name + '.tmp')
    image.save(temporary, format='JPEG' if file.suffix == '.jpg' else 'PNG', **options)
    temporary.replace(file)
for part in ['body', 'head']:
    with Image.open(source / f'm002_{part}_color.tga') as image:
        save(gameplay_size(image.convert('RGB')), f'{part}-color.jpg', quality=92, subsampling=0)
    with Image.open(source / f'm002_{part}_normal.tga') as image:
        r, g, b = gameplay_size(image.convert('RGB')).split()
        # GLTFLoader negates normalScale.y for meshes without tangent attributes;
        # this matches the corresponding conversion in Three's GLTFExporter.
        save(Image.merge('RGB', (r, ImageOps.invert(g), b)), f'{part}-normal.png', optimize=True)
with Image.open(source / 'm002_opacity_color.tga') as image:
    assert 'A' in image.getbands(), 'Hair must retain its source alpha channel.'
    save(gameplay_size(image), 'hair-color.png', optimize=True)
for file in target.iterdir():
    print(file.name, file.stat().st_size)
