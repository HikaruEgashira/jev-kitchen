#!/bin/sh
# Bakes public/og.png from a frame of the intro video. Run by hand after the key
# art or the tagline changes. ffmpeg is a dev-machine tool, so this is not wired
# into pnpm build.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
font="$root/assets/fonts/MPLUSRounded1c-Bold.ttf"
bg=0x102c27      # theme-color
accent=0xf0b03b
ink=0xfff9e8
muted=0xdbe3d2
# -ss 22 is the Lv10 kitchen with three cooks; the bottom band covers the
# burned-in caption and the control hints, so the crop keeps the play field.
ffmpeg -v error -y -ss 22 -i "$root/docs/sidekick-intro-30s.mp4" -frames:v 1 -compression_level 9 -vf "
scale=1200:675,crop=1200:630:0:24,
drawbox=x=0:y=396:w=1200:h=234:color=$bg:t=fill,
drawbox=x=0:y=394:w=1200:h=3:color=$accent:t=fill,
drawtext=fontfile=${font}:text='SIDEKICK kitchen':fontsize=74:fontcolor=$ink:x=64:y=436,
drawtext=fontfile=${font}:text='AIの相棒と、ふたりでひと皿。':fontsize=34:fontcolor=$muted:x=64:y=538
" "$root/public/og.png"
