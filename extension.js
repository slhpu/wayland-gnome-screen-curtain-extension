/* Screen Curtain is an accessibility extension for Wayland in GNOME 50/51.
 It creates a pure black overlay actor group and reduces display brightness 
 to 0 via brightnessctl to protect visual privacy while offering screen reader feedback. 
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export default class ScreenCurtainExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._actorGroup = null;
        this._overlays = [];
        this._curtainActive = false;
        this._cursorInhibited = false;
        this._idleInitId = 0;
        this._idleWakeId = 0;
        this._cursorTracker = global.backend.get_cursor_tracker
            ? global.backend.get_cursor_tracker()
            : Meta.CursorTracker.get_for_display(global.display);
        this._dbusConnection = Gio.DBus.system;
        this._savedBrightness = null;

        // Check if brightnessctl utility is installed in system path
        this._hasBrightnessCtl = GLib.find_program_in_path('brightnessctl') !== null;

        // Create master actor container for stage overlays
        this._actorGroup = new St.Widget({ name: 'screen-curtain-overlay-group' });
        this._resetGroupSize();
        global.stage.add_child(this._actorGroup);

        // Track stage container changes to maintain top z-index positioning
        const clutterContainer = Clutter.Container !== undefined;
        this._actorAddedConnection = global.stage.connect(
            clutterContainer ? 'actor-added' : 'child-added',
            this._restackOverlays.bind(this)
        );
        this._actorRemovedConnection = global.stage.connect(
            clutterContainer ? 'actor-removed' : 'child-removed',
            this._restackOverlays.bind(this)
        );

        // Keep overlays properly stacked during full-screen window transitions
        this._inFullscreenChangedId = global.stage.connect('notify::in-fullscreen', () => {
            if (this._curtainActive) {
                this._applyUnredirectInhibition(true);
                this._restackOverlays();
            }
        });

        // Enforce z-index stack handling when new windows spawn
        this._windowCreatedId = global.display.connect('window-created', (_, window) => {
            if (this._curtainActive) {
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this._applyUnredirectInhibition(true);
                    this._restackOverlays();
                    return GLib.SOURCE_REMOVE;
                });
            }
        });

        // Register master toggle shortcut keybinding
        Main.wm.addKeybinding(
            'curtain-shortcut',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.ALL,
            () => this._setCurtainState(!this._curtainActive)
        );

        // Register status announcement shortcut keybinding
        Main.wm.addKeybinding(
            'status-shortcut',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.ALL,
            () => {
                if (this._curtainActive) {
                    this._speakFeedback('Screen curtain is on');
                } else {
                    this._speakFeedback('Screen curtain is off');
                }
            }
        );

        // Recompute curtain dimensions when display monitor configurations change
        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
            this._resetGroupSize();
            if (this._curtainActive) {
                this._drawCurtainLayers();
            }
        });

        // Handle Session Screen Shield / Lock Screen transitions safely
        this._lockScreenSignalId = Main.screenShield.connect('active-changed', (_, isLocked) => {
            if (isLocked) {
                this._clearCurtainLayers();
                this._restoreBrightness();
            } else {
                this._clearCurtainLayers();

                if (this._idleWakeId) {
                    GLib.source_remove(this._idleWakeId);
                    this._idleWakeId = 0;
                }

                this._idleWakeId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this._idleWakeId = 0;
                    if (this._settings && this._settings.get_boolean('curtain-active')) {
                        this._drawCurtainLayers();
                        this._setBrightnessToZero();
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        });

        // Handle Suspend/Resume power states via system D-Bus signals
        this._setupSleepListener();

        // Restore active curtain state automatically if enabled upon session start
        if (this._settings.get_boolean('curtain-active')) {
            this._idleInitId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._idleInitId = 0;
                if (this._settings.get_boolean('curtain-active') && !Main.screenShield.locked) {
                    this._setCurtainState(true);
                }
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    disable() {
        // Clean up all background listeners, event connections, and timers
        if (this._idleInitId) {
            GLib.source_remove(this._idleInitId);
            this._idleInitId = 0;
        }
        if (this._idleWakeId) {
            GLib.source_remove(this._idleWakeId);
            this._idleWakeId = 0;
        }

        if (this._actorAddedConnection) {
            global.stage.disconnect(this._actorAddedConnection);
            this._actorAddedConnection = null;
        }

        if (this._actorRemovedConnection) {
            global.stage.disconnect(this._actorRemovedConnection);
            this._actorRemovedConnection = null;
        }

        if (this._inFullscreenChangedId) {
            global.stage.disconnect(this._inFullscreenChangedId);
            this._inFullscreenChangedId = 0;
        }

        if (this._windowCreatedId) {
            global.display.disconnect(this._windowCreatedId);
            this._windowCreatedId = 0;
        }

        if (this._dbusConnection && this._sleepSignalId) {
            this._dbusConnection.signal_unsubscribe(this._sleepSignalId);
            this._sleepSignalId = 0;
        }

        if (this._lockScreenSignalId) {
            Main.screenShield.disconnect(this._lockScreenSignalId);
            this._lockScreenSignalId = 0;
        }

        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }

        // Restore hardware state and destroy overlay components
        this._restoreBrightness();
        this._clearCurtainLayers();

        if (this._actorGroup) {
            global.stage.remove_child(this._actorGroup);
            this._actorGroup.destroy();
            this._actorGroup = null;
        }

        Main.wm.removeKeybinding('curtain-shortcut');
        Main.wm.removeKeybinding('status-shortcut');
        this._settings = null;
        this._cursorTracker = null;
        this._dbusConnection = null;
        this._savedBrightness = null;
        this._hasBrightnessCtl = false;
    }

    _resetGroupSize() {
        if (this._actorGroup) {
            this._actorGroup.set_size(global.screen_width, global.screen_height);
        }
    }

    _restackOverlays() {
        if (!this._actorGroup) return;

        if (this._actorGroup.get_parent()) {
            this._actorGroup.get_parent().set_child_above_sibling(this._actorGroup, null);
        }

        for (let i = 0; i < this._overlays.length; i++) {
            if (this._overlays[i]) {
                this._actorGroup.set_child_above_sibling(this._overlays[i], null);
            }
        }
    }

    // Toggle Wayland unredirect capability to prevent windows from bypassing compositor rendering
    _applyUnredirectInhibition(inhibit) {
        try {
            if (inhibit) {
                if (global.compositor?.disable_unredirect !== undefined) {
                    global.compositor.disable_unredirect();
                } else if (typeof Meta.disable_unredirect_for_display === 'function') {
                    Meta.disable_unredirect_for_display(global.display);
                }
            } else {
                if (global.compositor?.enable_unredirect !== undefined) {
                    global.compositor.enable_unredirect();
                } else if (typeof Meta.enable_unredirect_for_display === 'function') {
                    Meta.enable_unredirect_for_display(global.display);
                }
            }
        } catch (e) {
            console.error(`ScreenCurtain: Failed to toggle unredirect: ${e.message}`);
        }
    }

    // Query current backlight intensity level using brightnessctl
    _getCurrentBrightness() {
        if (!this._hasBrightnessCtl) return null;

        let proc = null;
        try {
            proc = new Gio.Subprocess({
                argv: ['brightnessctl', 'get'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE
            });
            proc.init(null);
            let [success, stdout] = proc.communicate_utf8(null, null);
            if (success && stdout) {
                return stdout.trim();
            }
        } catch (e) {
            console.error(`ScreenCurtain: Failed to get current brightness via brightnessctl: ${e.message}`);
        } finally {
            proc = null;
        }
        return null;
    }

    // Execute brightnessctl configuration changes asynchronously
    _runBrightnessctl(value) {
        if (!this._hasBrightnessCtl) return;

        try {
            let proc = new Gio.Subprocess({
                argv: ['brightnessctl', 'set', value.toString()],
                flags: Gio.SubprocessFlags.NONE
            });
            proc.init(null);
            proc.wait_async(null, (p, res) => {
                try {
                    p.wait_finish(res);
                } catch (e) {
                    // Handled
                }
            });
        } catch (e) {
            console.error(`ScreenCurtain: Failed to run brightnessctl set: ${e.message}`);
        }
    }

    // Save previous hardware brightness level and drop backlight brightness to 0
    _setBrightnessToZero() {
        if (!this._hasBrightnessCtl) return;

        try {
            if (this._savedBrightness === null) {
                const current = this._getCurrentBrightness();
                if (current !== null) {
                    this._savedBrightness = current;
                }
            }
            this._runBrightnessctl(0);
        } catch (e) {
            console.error(`ScreenCurtain: Failed to set brightness to zero: ${e.message}`);
        }
    }

    // Restore hardware brightness back to original pre-curtain levels
    _restoreBrightness() {
        if (!this._hasBrightnessCtl || this._savedBrightness === null) return;

        try {
            this._runBrightnessctl(this._savedBrightness);
            this._savedBrightness = null;
        } catch (e) {
            console.error(`ScreenCurtain: Failed to restore brightness: ${e.message}`);
        }
    }

    // Subscribe to systemd sleep/resume signals to manage hardware states cleanly
    _setupSleepListener() {
        try {
            this._sleepSignalId = this._dbusConnection.signal_subscribe(
                'org.freedesktop.login1',
                'org.freedesktop.login1.Manager',
                'PrepareForSleep',
                '/org/freedesktop/login1',
                null,
                Gio.DBusSignalFlags.NONE,
                (_connection, _senderName, _objectPath, _interfaceName, _signalName, parameters) => {
                    let [sleeping] = parameters.deep_unpack();

                    if (sleeping) {
                        this._restoreBrightness();
                        this._clearCurtainLayers();
                    } else if (!Main.screenShield.locked) {
                        if (this._idleWakeId) {
                            GLib.source_remove(this._idleWakeId);
                            this._idleWakeId = 0;
                        }

                        this._idleWakeId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                            this._idleWakeId = 0;
                            if (this._settings && this._settings.get_boolean('curtain-active')) {
                                this._drawCurtainLayers();
                                this._setBrightnessToZero();
                            }
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                }
            );
        } catch (e) {
            console.error(`ScreenCurtain: Failed to connect to sleep signal: ${e.message}`);
        }
    }

    // Toggle active status of curtain, updating settings, hardware brightness, and voice feedback
    _setCurtainState(active) {
        if (this._curtainActive === active) return;

        if (this._settings) {
            this._settings.set_boolean('curtain-active', active);
        }

        if (active) {
            if (!Main.screenShield.locked) {
                this._drawCurtainLayers();
                this._setBrightnessToZero();
            }
            this._speakFeedback('Screen curtain on');
        } else {
            this._restoreBrightness();
            this._clearCurtainLayers();
            this._speakFeedback('Screen curtain off');
        }
    }

    // Instantiate screen blackout layers across monitors and suppress mouse cursor visibility
    _drawCurtainLayers() {
        this._clearCurtainLayers();

        if (Main.layoutManager.monitors.length === 0 || Main.screenShield.locked) return;

        this._curtainActive = true;

        this._applyUnredirectInhibition(true);

        const overlay = new St.Widget({
            name: 'ScreenCurtainLayer',
            style: 'background-color: #000000;',
            reactive: true,
            x: 0,
            y: 0,
            width: global.screen_width,
            height: global.screen_height
        });

        this._actorGroup.add_child(overlay);
        this._overlays.push(overlay);

        this._restackOverlays();

        if (this._cursorTracker && !this._cursorInhibited && this._overlays.length > 0) {
            this._cursorTracker.inhibit_cursor_visibility();
            this._cursorInhibited = true;
        }
    }

    // Clean up blackout actors and un-inhibit the mouse cursor
    _clearCurtainLayers() {
        this._applyUnredirectInhibition(false);

        if (this._actorGroup) {
            this._overlays.forEach(overlay => {
                if (overlay) {
                    this._actorGroup.remove_child(overlay);
                    overlay.destroy();
                }
            });
        }
        this._overlays = [];
        this._curtainActive = false;

        if (this._cursorInhibited) {
            this._cursorInhibited = false;
            if (this._cursorTracker) {
                this._cursorTracker.uninhibit_cursor_visibility();
            }
        }
    }

    // Call Speech Dispatcher (`spd-say`) to announce curtain state transitions
    _speakFeedback(message) {
        if (!this._settings) return;
        const rate = this._settings.get_int('speech-rate').toString();
        const argv = ['spd-say', '-P', 'notification', '-r', rate, message];

        try {
            let proc = new Gio.Subprocess({
                argv: argv,
                flags: Gio.SubprocessFlags.NONE
            });
            proc.init(null);
            proc.wait_async(null, (p, res) => {
                try {
                    p.wait_finish(res);
                } catch (e) {
                    // Handled
                }
            });
        } catch (e) {
            console.error(`ScreenCurtain: Failed to call Speech Dispatcher: ${e.message}`);
        }
    }
}

