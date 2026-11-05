// Fonts for generated images (next/og needs TTF/OTF data): Martian Mono, subset to the characters used.
export async function font(family: string, weight: number, text: string) {
  const glyphs = [...new Set(text + text.toUpperCase())].join("");
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}&text=${encodeURIComponent(glyphs)}`)).text();
  const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
  if (!url) throw new Error(`No font for ${family}`);
  return (await fetch(url)).arrayBuffer();
}
