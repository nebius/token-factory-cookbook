#!/bin/bash
## On Linux
## 		sudo apt install  imagemagic inkscape librsvg2-bin
## On MacOS (with Homebrew)
##		brew install  imagemagick inkscape librsvg


## convert SVG files (passed as arguments) to PNG
if [[ $# -lt 1 ]]; then
	echo "Usage: $0 file1.svg [file2.svg ...]"
	exit 1
fi

for file in "$@"; do
	if [[ -f "$file" && "$file" == *.svg ]]; then
		# inkscape --export-type=png "$file"
		# magick -background none -density 300 "$file" "images/$(basename "$file" .svg).png"
		magick -background none "$file" "images/$(basename "$file" .svg).png"
	else
		echo "Skipping $file (not an SVG file)"
	fi
done

## process only PNGs generated from SVGs in step above
annotated_dir="images/annotated"
mkdir -p "$annotated_dir"

generated_pngs=()
for file in "$@"; do
	if [[ -f "$file" && "$file" == *.svg ]]; then
		png_file="images/$(basename "$file" .svg).png"
		if [[ -f "$png_file" ]]; then
			generated_pngs+=("$png_file")
		fi
	fi
done

for file in "${generated_pngs[@]}"; do
	out_file="$annotated_dir/$(basename "$file")"
	magick "$file" \
		-font Arial -pointsize 18 -fill black -stroke none \
		-gravity NorthEast -annotate +10+10 "${file##*/}" \
		"$out_file"
done
