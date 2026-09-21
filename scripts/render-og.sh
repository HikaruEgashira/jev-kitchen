#!/bin/sh
# Bakes public/og.png from assets/og-background.png. Run by hand after the key
# art or the title changes. ffmpeg is a dev-machine tool, so this is not wired
# into pnpm build.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
font="$root/assets/fonts/MPLUSRounded1c-Bold.ttf"
bg=0x102c27      # theme-color
accent=0xf0b03b
ink=0xfff9e8
# The band covers the action buttons the game draws along the bottom.
ffmpeg -v error -y -i "$root/assets/og-background.png" -compression_level 9 -vf "
scale=1200:630,
drawbox=x=0:y=420:w=1200:h=210:color=$bg:t=fill,
drawbox=x=0:y=418:w=1200:h=3:color=$accent:t=fill,
drawtext=fontfile=${font}:text='SIDEKICK kitchen':fontsize=84:fontcolor=$ink:x=64:y=462
" "$root/public/og.png"
