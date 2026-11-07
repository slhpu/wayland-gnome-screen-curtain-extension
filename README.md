Wayland Screen Curtain for Accessibility and Privacy

A GNOME Shell extension built for Wayland compositors that creates a pure black screen blackout overlay, sets hardware backlight brightness to zero using brightnessctl for absolute visual privacy, suppresses mouse cursor visibility, and delivers Speech Dispatcher audio feedback.

Prerequisites:

This extension utilizes brightnessctl to drop hardware backlight brightness to zero. Please ensure brightnessctl is installed via your system package manager (e.g., sudo dnf install brightnessctl on Fedora).

Features:

Pure black curtain overlays mapped across all active monitors.

Hardware backlight dimming via brightnessctl integration.

Mouse cursor visibility inhibition.

Wayland unredirect inhibition to prevent fullscreen windows from bypassing the compositor layer.

Automatic sleep, suspend, and lock screen state safety handling.

Speech Dispatcher audio feedback for curtain state changes.

Installation:

Ensure brightnessctl is installed on your system.

Clone or download this repository into your local GNOME extensions directory: git clone https://github.com/your-username/gnome-wayland-screen-curtain.git ~/.local/share/gnome-shell/extensions/screen-curtain@accessibility.local

Compile the GSettings schema files: glib-compile-schemas ~/.local/share/gnome-shell/extensions/screen-curtain@accessibility.local/schemas/
(note: you may need to delete the schemas.compiled file in the schemas folder first)

Restart GNOME Shell (or log out and back in on Wayland).

Enable the extension using Extension Manager or via terminal: gnome-extensions enable screen-curtain@accessibility.local

License: This project is licensed under the GNU General Public License v3.0.								
