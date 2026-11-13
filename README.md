Wayland Screen Curtain for Accessibility and Privacy

A GNOME Shell extension built for Wayland compositors that creates a pure black screen blackout overlay, dims the hardware backlight while the screen curtain is active using brightnessctl, suppresses mouse cursor visibility, and delivers Speech Dispatcher audio feedback.

Prerequisites:

Wayland session, this has only been tested for gnome 50 and 51, but may also work on earlier gnome wayland sessions if you change the metadata.json file to accommodate the version.

Gnome Extension Manager, you will need the extension manager installed to access the preferences window.

To install the Gnome Extension Manager

On fedora 44/45 via flatpak

`flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo`

You can then search the software store for the gnome extension manager or run

`flatpak install flathub com.mattjakeman.ExtensionManager`

On Ubuntu 26.04 run

`sudo apt update && sudo apt install gnome-shell-extension-manager`

This extension utilizes brightnessctl to dim the hardware backlight while the screen curtain is active. 

Please ensure brightnessctl is installed via your system package manager 

`sudo dnf install brightnessctl` on Fedora

`sudo apt update && sudo apt install brightnessctl` on Ubuntu

This is not a hard requirement, the extension will check your PATH environment variable to check if brightnessctl is installed and if it is not that code will not execute.

Features:

Customizable keyboard shortcuts in preferences to toggle the screen curtain and check the screen curtain state.

By default these are:

Toggle screen curtain; `Ctrl + Alt + M`

Check screen curtain status; `Ctrl + Super + M`

Customizable voice rate slider in preferences to change the voice rate.

Pure black curtain overlays mapped across all active monitors.

Hardware backlight dimming via brightnessctl integration.

Mouse cursor visibility inhibition.

Wayland unredirect inhibition to prevent fullscreen windows from bypassing the compositor layer.

Automatic sleep, suspend, and lock screen state safety handling.

Speech Dispatcher audio feedback for curtain state changes.

Installation:

First install the Gnome Extension Manager

On fedora 44/45 via flatpak

`flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo`

You can then search the software store for the gnome extension manager or run

`flatpak install flathub com.mattjakeman.ExtensionManager`

On Ubuntu 26.04 run

`sudo apt update && sudo apt install gnome-shell-extension-manager`

Ensure brightnessctl is installed on your system.

`sudo dnf install brightnessctl` on fedora

`sudo apt update && sudo apt install brightnessctl` on ubuntu

If you can't get brightnessctl, don't worry, the extension will check your PATH variable for brightnessctl and if it is not installed that code will not execute.

Next, clone or download this repository into your local GNOME extensions directory: 

`git clone https://github.com/slhpu/wayland-gnome-screen-curtain-extension.git ~/.local/share/gnome-shell/extensions/screen-curtain@accessibility.local`

The schema file should already be present in the schemas folder, you can check by looking for gschemas.compiled in the schemas folder, if it is not in the schemas folder or the extension erros then delete the file and compile the schema.

`glib-compile-schemas ~/.local/share/gnome-shell/extensions/screen-curtain@accessibility.local/schemas/`

Restart GNOME Shell or log out and back in.

Enable the extension using Extension Manager or via terminal: 

`gnome-extensions enable screen-curtain@accessibility.local`

License: This project is licensed under the GNU General Public License v3.0.								

About: This extension was built using the help of AI tools, but has been checked and edited by the author.

I will not be updating this extension regularly except for my own personal use as I do not have the time or expertise to commit to extension maintenance.
If you would like to fork this extension and package it for download in the gnome extension manager then please feel free to do so with my thanks.
