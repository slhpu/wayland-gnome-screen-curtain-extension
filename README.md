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

Depending on your system and hardware backlight device brighnessctl may not have the permissions to run from within the extension even if it is installed. You can check this after installing the extension by following the installation instructions.

Features:

Customizable keyboard shortcuts in preferences to toggle the screen curtain and check the screen curtain state.

By default these are:

Toggle screen curtain; `Ctrl + Alt + M`

Check screen curtain status; `Ctrl + Super + M`

Customizable keyboard shortcut in preferences to toggle mouse inhibition while the curtain is active.

By default this is: `Ctrl + Alt + U`

Toggle switch in preferences to disable or enable mouse inhibition entirely for mouse tracking and flat review if you ever run into any issues.

Customizable voice rate slider in preferences to change the voice rate.

Pure black curtain overlays mapped across all active monitors.

Hardware backlight dimming via brightnessctl integration.

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

You may run into permission issues with brightnessctl depending on your backlight device and system, I found this more common on Ubuntu than fedora. Once you have completed installing the extension, you can check brightnessctl issues with the extension enabled and running the following in your terminal:

`journalctl /usr/bin/gnome-shell -f | grep -i ScreenCurtain`

If you toggle the screen curtain while this is active in your terminal it will help you determine any issues with brightnessctl. I would like to list how to fix them, but I can't reliably list them all. If you can't figure out the fix, just uninstall brightnessctl and let the extension run as normal without filling your journalctl with errors.

I will give you the fix for the permission error that I ran into on Ubuntu 26.04 but your experience may differ.

I received the following error log:

`ScreenCurtain: brightnessctl set 0 (amdgpu_bl1) failed (exit 1): Can't modify brightness: Permission denied`
`ScreenCurtain: brightnessctl set 20119 (amdgpu_bl1) failed (exit 1): Can't modify brightness: Permission denied`

I ran `ls -l /sys/class/backlight/*/brightness` to list all backlight devices along with a space separated list of groups

`-rw-rw-r-- 1 root video 4096 Nov 19 14:40 /sys/class/backlight/amdgpu_bl1/brightness`

The 1 at the start is why permission is denied for the extension, root and video are the groups and amdgpu_bl1 is what brightnessctl is targeting.

Next I created a udev rule for all backlight devices for uaccess and the video group:

`echo 'ACTION=="add", SUBSYSTEM=="backlight", KERNEL=="*", TAG+="uaccess", GROUP="video", MODE="0660"' | sudo tee /etc/udev/rules.d/90-backlight-screen-curtain.rules`

Reload and trigger the rules:

`sudo udevadm control --reload-rules && sudo udevadm trigger --subsystem-match=backlight`

Then I added my own user to the video group:

`sudo usermod -aG video $USER` then log out and back in. After this, brightnessctl worked correctly with no errors, I hope this helps others who have issues.

Next, clone or download this repository into your local GNOME extensions directory:

To run the below command, ensure git is installed first.

`sudo dnf innstall git` on fedora.

`sudo apt update && sudo apt install git` on Ubuntu.

`git clone https://github.com/slhpu/wayland-gnome-screen-curtain-extension.git ~/.local/share/gnome-shell/extensions/screen-curtain@accessibility.local`

The schema file should already be present in the schemas folder, you can check by looking for gschemas.compiled in the schemas folder, if it is not in the schemas folder or the extension erros then delete the file and compile the schema.

`glib-compile-schemas ~/.local/share/gnome-shell/extensions/screen-curtain@accessibility.local/schemas/`

Restart GNOME Shell or log out and back in.

Enable the extension using Extension Manager or via terminal: 

`gnome-extensions enable screen-curtain@accessibility.local`

License: This project is licensed under the GNU General Public License v3.0.								

About: This extension was built using the help of AI tools, but has been checked and edited by the author.

I will not be updating this extension regularly except for my own personal use as I do not have the time or expertise to commit to professional level extension maintenance.
If you would like to fork this extension and package it for download in the gnome extension manager then please feel free to do so with my thanks.
