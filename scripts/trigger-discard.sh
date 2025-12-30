#!/bin/bash
# Trigger tab discard via keyboard shortcut
# This script sends the keyboard shortcut to Chrome

osascript <<EOF
tell application "Google Chrome"
    activate
    delay 0.2
end tell

tell application "System Events"
    keystroke "k" using {command down, shift down}
end tell
EOF
