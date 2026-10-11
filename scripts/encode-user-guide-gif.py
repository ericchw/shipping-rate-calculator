"""Encode the Playwright walkthrough frames. Requires Pillow."""
from pathlib import Path
from PIL import Image

frames = []
for path in sorted(Path("data/user-guide-frames").glob("*.png")):
    with Image.open(path) as image:
        frame = image.convert("RGB")
        frame.thumbnail((1080, 750))
        frames.append(frame.quantize(colors=128))

if len(frames) != 8:
    raise SystemExit("Run scripts/capture-user-guide.cjs first to create eight frames.")

output = Path("docs/images/user-guide/rate-walkthrough.gif")
frames[0].save(output, save_all=True, append_images=frames[1:],
               duration=[2500] * 7 + [3500], loop=0, optimize=True, disposal=2)
print(f"Created {output} ({output.stat().st_size} bytes)")
