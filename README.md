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

If you can't get brightnessctl, don't worry, the extension will check your PATH variable for brightnessctl and if it is not installed that code will not execute.

Clone or download this repository into your local GNOME extensions directory: git clone https://github.com/your-username/wayland-gnome-screen-curtain-extension.git ~/.local/share/gnome-shell/extensions/screen-curtain@accessibility.local

The schema file should already be present in the schemas folder, you can check by looking for schemas.compiled if it is not in the schemas folder or the extension erros then delete the file and compile the schema.
Compile the GSettings schema files: glib-compile-schemas ~/.local/share/gnome-shell/extensions/screen-curtain@accessibility.local/schemas/

Restart GNOME Shell (or log out and back in on Wayland).

Enable the extension using Extension Manager or via terminal: gnome-extensions enable screen-curtain@accessibility.local

License: This project is licensed under the GNU General Public License v3.0.								

About: This extension was built using the help of AI tools, but has been checked and edited by the author.

I will not be updating this extension regularly except for my own personal use as I do not have the time or expertise to commit to extension maintenance.
If you would like to fork this extension and package it for the gnome extension store then please feel free to do so with my thanks.
