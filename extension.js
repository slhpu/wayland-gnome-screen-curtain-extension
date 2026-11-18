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
import GObject from 'gi://GObject';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// MouseSpriteContent adapted from Soft Brightness Plus copied largely from cursor.js
const MouseSpriteContent = GObject.registerClass({
    Implements: [Clutter.Content],
}, class MouseSpriteContent extends GObject.Object {
    _init() {
        super._init();
        this._texture = null;
    }

    vfunc_get_preferred_size() {
        if (!this._texture)
            return [false, 0, 0];

        return [true, this._texture.get_width(), this._texture.get_height()];
    }

    vfunc_paint_content(actor, node, _paintContext) {
        if (!this._texture)
            return;

        let [minFilter, magFilter] = actor.get_content_scaling_filters();
        let textureNode = new Clutter.TextureNode(this._texture,
            null, minFilter, magFilter);
        textureNode.set_name('ScreenCurtainMouseSpriteContent');
        node.add_child(textureNode);

        textureNode.add_rectangle(actor.get_content_box());
    }

    get texture() {
        return this._texture;
    }

    set texture(coglTexture) {
        if (this._texture === coglTexture)
            return;

        let oldTexture = this._texture;
        this._texture = coglTexture;
        this.invalidate();

        if (!oldTexture || !coglTexture ||
            oldTexture.get_width() !== coglTexture.get_width() ||
            oldTexture.get_height() !== coglTexture.get_height())
            this.invalidate_size();
    }
});

// CursorTrackerPointerWatcher adapted from Soft Brightness Plus cursor.js
class CursorTrackerPointerWatcher {
    constructor(cursorTracker) {
        this._cursorTracker = cursorTracker;
    }

    addWatch(fn) {
        const laters = global.compositor.get_laters();
        let laterId = 0;
        const positionId = this._cursorTracker.connect('position-invalidated', () => {
            if (laterId)
                return;
            laterId = laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
                laterId = 0;
                fn();
                return GLib.SOURCE_REMOVE;
            });
        });
        return {
            remove: () => {
                this._cursorTracker.disconnect(positionId);
                if (laterId)
                    laters.remove(laterId);
            },
        };
    }
}

export default class ScreenCurtainExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._actorGroup = null;
        this._overlays = [];
        this._curtainActive = false;
        this._cursorHidden = false;
        this._cursorUnfocusInhibited = false;
        this._userForcedMouseVisible = false;
        this._idleInitId = 0;
        this._idleWakeId = 0;
        this._cursorTracker = global.backend.get_cursor_tracker
            ? global.backend.get_cursor_tracker()
            : Meta.CursorTracker.get_for_display(global.display);
        this._dbusConnection = Gio.DBus.system;
        this._savedBrightness = null;

        // Mouse cloning properties
        this._cursorSprite = null;
        this._cursorActor = null;
        this._cursorWatcher = null;
        this._cursorWatch = null;
        this._cursorChangedConnection = null;
        this._cursorVisibilityChangedConnection = null;

        // Listen for changes to the pointer-inhibition setting dynamically
        this._inhibitionChangedId = this._settings.connect('changed::pointer-inhibition', () => {
            if (this._curtainActive) {
                this._updateMouseInhibitionState();
            }
        });

        // Check if brightnessctl utility is installed in system path
        this._hasBrightnessCtl = GLib.find_program_in_path('brightnessctl') !== null;

        // Create master actor container for stage overlays (non-reactive so pointer clicks pass through)
        this._actorGroup = new St.Widget({
            name: 'screen-curtain-overlay-group',
            reactive: false
        });
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

        // Register mouse visibility shortcut keybinding (bypassed if pointer-inhibition is disabled)
        Main.wm.addKeybinding(
            'mouse-shortcut',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.ALL,
            () => {
                if (!this._settings.get_boolean('pointer-inhibition')) {
                    this._speakFeedback('Pointer inhibition is disabled');
                    return;
                }

                if (this._curtainActive) {
                    // Toggle forced visibility state when curtain is active
                    this._userForcedMouseVisible = !this._userForcedMouseVisible;
                    this._updateMouseInhibitionState();
                    if (this._userForcedMouseVisible) {
                        this._speakFeedback('mouse cursor visible');
                    } else {
                        this._speakFeedback('mouse cursor hidden');
                    }
                } else {
                    // When curtain is off, shortcut output must be "screen curtain is off"
                    this._speakFeedback('screen curtain is off');
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
        if (this._inhibitionChangedId) {
            this._settings.disconnect(this._inhibitionChangedId);
            this._inhibitionChangedId = 0;
        }

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
        this._userForcedMouseVisible = false;
        this._restoreBrightness();
        this._clearCurtainLayers();

        if (this._actorGroup) {
            global.stage.remove_child(this._actorGroup);
            this._actorGroup.destroy();
            this._actorGroup = null;
        }

        Main.wm.removeKeybinding('curtain-shortcut');
        Main.wm.removeKeybinding('status-shortcut');
        Main.wm.removeKeybinding('mouse-shortcut');
        this._settings = null;
        this._cursorTracker = null;
        this._dbusConnection = null;
        this._savedBrightness = null;
        this._hasBrightnessCtl = false;
    }

    // Reset the size of the overlay across monitor layouts
    _resetGroupSize() {
        if (this._actorGroup && Main.layoutManager) {
            let maxWidth = 0;
            let maxHeight = 0;
            for (let monitor of Main.layoutManager.monitors) {
                maxWidth = Math.max(maxWidth, monitor.x + monitor.width);
                maxHeight = Math.max(maxHeight, monitor.y + monitor.height);
            }
            this._actorGroup.set_size(
                maxWidth > 0 ? maxWidth : global.stage.width,
                maxHeight > 0 ? maxHeight : global.stage.height
            );
        }
    }

    // Continue to Stack the Overlay above new Parent groups spawned in Global.stage
    _restackOverlays() {
        if (!this._actorGroup || !this._actorGroup.get_parent()) return;

        if (this._actorGroup.get_parent()) {
            this._actorGroup.get_parent().set_child_above_sibling(this._actorGroup, null);
        }

        for (let i = 0; i < this._overlays.length; i++) {
            if (this._overlays[i]) {
                this._actorGroup.set_child_above_sibling(this._overlays[i], null);
            }
        }

        if (this._cursorActor) {
            this._actorGroup.set_child_above_sibling(this._cursorActor, null);
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
                    console.error(`ScreenCurtain: brightnessctl set failed: ${e.message}`);
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
            // Reset user-forced mouse preference to default (hidden/inhibited) when turning curtain on
            this._userForcedMouseVisible = false;
            if (!Main.screenShield.locked) {
                this._drawCurtainLayers();
                this._setBrightnessToZero();
            }
            this._speakFeedback('Screen curtain on');
        } else {
            // Guarantee mouse is always visible when turning the curtain off
            this._userForcedMouseVisible = false;
            this._restoreBrightness();
            this._clearCurtainLayers();
            this._speakFeedback('Screen curtain off');
        }
    }

    // Manages the actual inhibition state based on whether the curtain is active 
    // and whether the user explicitly forced mouse visibility via shortcut, using Soft Brightness + seat/cursor inhibition pattern.
    _updateMouseInhibitionState() {
        if (!this._cursorTracker) return;

        // If pointer inhibition is disabled in preferences, clear any active cloning/inhibition and return early
        const pointerInhibitionEnabled = this._settings.get_boolean('pointer-inhibition');
        const seat = Clutter.get_default_backend().get_default_seat();

        if (!pointerInhibitionEnabled) {
            this._disableCloningMouse();
            if (seat && this._cursorUnfocusInhibited) {
                seat.uninhibit_unfocus();
                this._cursorUnfocusInhibited = false;
            }
            if (this._cursorHidden) {
                this._cursorHidden = false;
                this._cursorTracker.uninhibit_cursor_visibility();
            }
            global.stage.queue_redraw();
            return;
        }

        const shouldInhibit = this._curtainActive && !this._userForcedMouseVisible;

        if (shouldInhibit) {
            if (seat && !this._cursorUnfocusInhibited) {
                seat.inhibit_unfocus();
                this._cursorUnfocusInhibited = true;
            }
            if (!this._cursorHidden) {
                this._cursorHidden = true;
                this._cursorTracker.inhibit_cursor_visibility();
            }
            this._disableCloningMouse();
        } else {
            if (seat && this._cursorUnfocusInhibited) {
                seat.uninhibit_unfocus();
                this._cursorUnfocusInhibited = false;
            }
            if (this._cursorHidden) {
                this._cursorHidden = false;
                this._cursorTracker.uninhibit_cursor_visibility();
            }

            // Enable mouse cloning if the curtain is active and user forced mouse visible,
            if (this._curtainActive && this._userForcedMouseVisible) {
                this._enableCloningMouse();
            } else {
                this._disableCloningMouse();
            }
        }

        if (typeof this._cursorTracker.queue_image_update === 'function') {
            this._cursorTracker.queue_image_update();
        }
        global.stage.queue_redraw();
    }

    _enableCloningMouse() {
        if (this._cursorWatch !== null) return;
        
        this._cursorSprite = new Clutter.Actor({ request_mode: Clutter.RequestMode.CONTENT_SIZE });
        this._cursorSprite.content = new MouseSpriteContent();

        this._cursorActor = new Clutter.Actor();
        this._cursorActor.add_child(this._cursorSprite);
        this._cursorWatcher = new CursorTrackerPointerWatcher(this._cursorTracker);

        this._actorGroup.add_child(this._cursorActor);
        this._cursorChangedConnection = this._cursorTracker.connect(
            'cursor-changed', this._updateMouseSprite.bind(this));
        this._cursorVisibilityChangedConnection = this._cursorTracker.connect(
            'visibility-changed', this._updateMouseSprite.bind(this));
        this._cursorWatch = this._cursorWatcher.addWatch(this._updateMousePosition.bind(this));

        this._updateMouseSprite();
        this._updateMousePosition();
        this._restackOverlays();
    }

    _disableCloningMouse() {
        if (this._cursorWatch !== null) {
            this._cursorWatch.remove();
            this._cursorWatch = null;

            if (this._cursorChangedConnection) {
                this._cursorTracker.disconnect(this._cursorChangedConnection);
                this._cursorChangedConnection = null;
            }

            if (this._cursorVisibilityChangedConnection) {
                this._cursorTracker.disconnect(this._cursorVisibilityChangedConnection);
                this._cursorVisibilityChangedConnection = null;
            }

            if (this._cursorActor && this._actorGroup) {
                this._actorGroup.remove_child(this._cursorActor);
            }
        }

        if (this._cursorSprite) {
            this._cursorSprite.destroy();
            this._cursorSprite = null;
        }

        if (this._cursorActor) {
            this._cursorActor.destroy();
            this._cursorActor = null;
        }

        this._cursorWatcher = null;
    }

    _updateMousePosition() {
        if (!this._cursorActor) return;
        const [x, y] = global.get_pointer();
        this._cursorActor.set_position(x, y);
    }

    _updateMouseSprite() {
        if (!this._cursorSprite || !this._cursorTracker) return;
        const sprite = this._cursorTracker.get_sprite();
        if (sprite) {
            this._cursorSprite.content.texture = sprite;
            this._cursorSprite.show();
        } else {
            this._cursorSprite.hide();
        }

        const [xHot, yHot] = this._cursorTracker.get_hot();
        this._cursorSprite.set({
            translation_x: -xHot,
            translation_y: -yHot,
        });
    }

    // Instantiate screen blackout layers across all monitors and update mouse inhibition state
    _drawCurtainLayers() {
        this._clearCurtainLayers();

        if (Main.layoutManager.monitors.length === 0 || Main.screenShield.locked) return;

        this._curtainActive = true;

        this._applyUnredirectInhibition(true);

        // Set reactive: false so mouse clicks and hover events pass straight through to underlying windows
        for (let monitor of Main.layoutManager.monitors) {
            const overlay = new St.Widget({
                name: 'ScreenCurtainLayer',
                style: 'background-color: #000000;',
                reactive: false,
                x: monitor.x,
                y: monitor.y,
                width: monitor.width,
                height: monitor.height
            });

            this._actorGroup.add_child(overlay);
            this._overlays.push(overlay);
        }

        this._restackOverlays();

        // Update mouse cursor visibility according to current rules
        this._updateMouseInhibitionState();
    }

    // Clean up blackout actors and un-inhibit the mouse cursor (always visible when curtain is off)
    _clearCurtainLayers() {
        this._applyUnredirectInhibition(false);

        this._disableCloningMouse();

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

        const seat = Clutter.get_default_backend().get_default_seat();

        if (seat && this._cursorUnfocusInhibited) {
            seat.uninhibit_unfocus();
            this._cursorUnfocusInhibited = false;
        }

        if (this._cursorHidden) {
            this._cursorHidden = false;
            if (this._cursorTracker) {
                this._cursorTracker.uninhibit_cursor_visibility();
            }
        }

        if (this._cursorTracker?.queue_image_update) {
            this._cursorTracker.queue_image_update();
        }
        global.stage.queue_redraw();
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

