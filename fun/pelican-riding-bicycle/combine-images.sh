#!/bin/bash
# Usage: ./combine-images.sh input1.png input2.png ... -o output.png

if [[ $# -lt 3 ]]; then
    echo "Usage: $0 -o output.png [--layout RxC] input1.png input2.png ..."
    exit 1
fi


# Parse arguments
inputs=()
output=""
layout=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        -o)
            shift
            output="$1"
            ;;
        --layout)
            shift
            layout="$1"
            ;;
        *)
            inputs+=("$1")
            ;;
    esac
    shift
done

if [[ -z "$output" ]]; then
    echo "Error: Output file must be specified with -o flag."
    exit 1
fi

rm -f "$output"  # Remove existing output file if it exists

# Remove any input PNG files that don't exist
valid_inputs=()
for img in "${inputs[@]}"; do
    if [[ -f "$img" ]]; then
        valid_inputs+=("$img")
    #else
        # echo "Warning: $img does not exist and will be skipped."
    fi
done

if [[ ${#valid_inputs[@]} -eq 0 ]]; then
    echo "Error: No valid input PNG files to combine."
    exit 1
fi

# Combine images as grid if --layout is provided
if [[ -n "$layout" ]]; then
    # layout format: RxC (e.g., 2x3)
    if [[ "$layout" =~ ^([0-9]+)x([0-9]+)$ ]]; then
        rows=${BASH_REMATCH[1]}
        cols=${BASH_REMATCH[2]}
        total=$((rows * cols))
        if (( ${#valid_inputs[@]} < total )); then
            echo "Warning: Not enough images for grid ($rows x $cols), filling with blanks."
        fi
        # Prepare montage input (pad with null: if needed)
        grid_inputs=("${valid_inputs[@]}")
        while (( ${#grid_inputs[@]} < total )); do
            grid_inputs+=("xc:white")
        done
        montage "${grid_inputs[@]}" -tile ${cols}x${rows} -geometry +0+0 "$output"
    else
        echo "Error: Invalid layout format. Use --layout RxC (e.g., 2x3)"
        exit 1
    fi
else
    # Default: vertical append
    magick "${valid_inputs[@]}" -append "$output"
fi
