# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow>=10.1"]
# ///
"""Draw the bar chart that app.py asks Kimi K3.1 Pro to read. Run once; chart.png is committed."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

TITLE = "Monthly active developers (thousands)"
BARS = [("Jan", 12), ("Feb", 15), ("Mar", 21), ("Apr", 18), ("May", 26), ("Jun", 24)]
WIDTH, HEIGHT = 900, 540
LEFT, RIGHT, TOP, BOTTOM = 90, 40, 80, 70


def main() -> None:
    image = Image.new("RGB", (WIDTH, HEIGHT), "white")
    draw = ImageDraw.Draw(image)
    title_font = ImageFont.load_default(size=28)
    label_font = ImageFont.load_default(size=22)

    draw.text((LEFT, 24), TITLE, fill="black", font=title_font)
    plot_width = WIDTH - LEFT - RIGHT
    plot_height = HEIGHT - TOP - BOTTOM
    scale = plot_height / 30
    draw.line((LEFT, TOP, LEFT, TOP + plot_height), fill="black", width=2)
    draw.line((LEFT, TOP + plot_height, LEFT + plot_width, TOP + plot_height), fill="black", width=2)
    for tick in range(0, 31, 10):
        y = TOP + plot_height - tick * scale
        draw.line((LEFT - 8, y, LEFT, y), fill="black", width=2)
        draw.text((LEFT - 50, y - 12), str(tick), fill="black", font=label_font)

    slot = plot_width / len(BARS)
    bar_width = slot * 0.6
    for index, (label, value) in enumerate(BARS):
        x0 = LEFT + index * slot + (slot - bar_width) / 2
        y0 = TOP + plot_height - value * scale
        draw.rectangle((x0, y0, x0 + bar_width, TOP + plot_height), fill="#4C72B0")
        draw.text((x0 + bar_width / 2 - 12, y0 - 30), str(value), fill="black", font=label_font)
        draw.text((x0 + bar_width / 2 - 18, TOP + plot_height + 12), label, fill="black", font=label_font)

    image.save(Path(__file__).with_name("chart.png"))


if __name__ == "__main__":
    main()
