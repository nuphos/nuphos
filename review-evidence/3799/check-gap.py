"""Check the light fixture captures on the two 1080px-wide API 33 AVDs."""
from pathlib import Path
import sys
from PIL import Image

path = Path(sys.argv[1])
image = Image.open(path).convert("RGB")
assert image.width == 1080
sample_columns = (160, 200, 450, 600, 800)
keyboard_top = {2400: 1649, 1440: 699}[image.height]
def composer_pixel(x, y):
    reference = image.getpixel((20, y))[0]
    red, green, blue = image.getpixel((x, y))
    # The keyboard shadow darkens both the sheet margin and the composer.
    return 18 <= reference - red <= 26 and red == green and 2 <= blue - red <= 4
composer_bottom = max(
    y for y in range(keyboard_top)
    if sum(composer_pixel(x, y) for x in sample_columns) >= 2
) + 1
gap = keyboard_top - composer_bottom
print(f"{path}: composer={composer_bottom}px keyboard={keyboard_top}px gap={gap}px", flush=True)
assert gap <= 2, "The New Task composer must reach the keyboard"

