import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const genParam = (type, name, ...dflt) => GObject.ParamSpec[type](name, name, name, GObject.ParamFlags.READWRITE, ...dflt);

export default class ScreenCurtainPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        let settings = this.getSettings();
        let page = new Adw.PreferencesPage();

        // Toggle Shortcut Button
        const deleteShortcutButton = new Gtk.Button({
            icon_name: 'edit-delete-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['error'],
            hexpand: false,
            vexpand: false
        });

        let group = new Adw.PreferencesGroup({
            title: 'Curtain Settings',
            header_suffix: deleteShortcutButton
        });

        const shortcutKeyBoard = new ShortcutSettingWidget(
            settings,
            'curtain-shortcut',
            'Toggle Keybind',
            'Press Backspace to clear shortcut'
        );

        // Hide/Show delete button based on active state
        if (!shortcutKeyBoard.isAcceleratorSet()) {
            deleteShortcutButton.visible = false;
        }

        deleteShortcutButton.connect('clicked', () => {
            shortcutKeyBoard.resetAccelerator();
        });

        settings.connect('changed::curtain-shortcut', () => {
            if (shortcutKeyBoard.isAcceleratorSet()) {
                deleteShortcutButton.visible = true;
            } else {
                deleteShortcutButton.visible = false;
            }
        });

        group.add(shortcutKeyBoard);

        // Status Announcement Shortcut Row Widget
        const deleteStatusButton = new Gtk.Button({
            icon_name: 'edit-delete-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['error'],
            hexpand: false,
            vexpand: false
        });

        let statusGroup = new Adw.PreferencesGroup({
            title: 'Status Announcement Settings',
            header_suffix: deleteStatusButton
        });

        const statusShortcutKeyBoard = new ShortcutSettingWidget(
            settings,
            'status-shortcut',
            'Status Announcement Keybind',
            'Press Backspace to clear shortcut'
        );

        if (!statusShortcutKeyBoard.isAcceleratorSet()) {
            deleteStatusButton.visible = false;
        }

        deleteStatusButton.connect('clicked', () => {
            statusShortcutKeyBoard.resetAccelerator();
        });

        settings.connect('changed::status-shortcut', () => {
            if (statusShortcutKeyBoard.isAcceleratorSet()) {
                deleteStatusButton.visible = true;
            } else {
                deleteStatusButton.visible = false;
            }
        });

        statusGroup.add(statusShortcutKeyBoard);

        // Speech Rate Slider Row
        let rateRow = new Adw.ActionRow({
            title: 'Speech Output Rate Adjustment',
            subtitle: 'Alters output speed variables handled by the local audio loop'
        });

        let adjustment = new Gtk.Adjustment({
            lower: -100,
            upper: 100,
            step_increment: 5,
            page_increment: 10,
            value: settings.get_int('speech-rate')
        });

        let scale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment: adjustment,
            digits: 0,
            value_pos: Gtk.PositionType.RIGHT,
            draw_value: true,
            hexpand: true,
            valign: Gtk.Align.CENTER
        });
        scale.set_size_request(200, -1);

        adjustment.connect('value-changed', (adj) => {
            settings.set_int('speech-rate', Math.round(adj.get_value()));
        });

        rateRow.add_suffix(scale);
        group.add(rateRow);

        page.add(group);
        page.add(statusGroup);
        window.add(page);
    }
}

// Shortcut Setting Widget
const ShortcutSettingWidget = class extends Adw.ActionRow {
    static {
        GObject.registerClass({
            Properties: {
                shortcut: genParam('string', 'shortcut', '')
            },
            Signals: {
                changed: { param_types: [GObject.TYPE_STRING] }
            }
        }, this);
    }

    constructor(settings, key, label, sublabel) {
        super({
            title: label,
            subtitle: sublabel,
            activatable: true
        });

        this.shortcutBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            halign: Gtk.Align.CENTER,
            spacing: 5,
            hexpand: false,
            vexpand: false
        });

        this._key = key;
        this._settings = settings;
        this._description = sublabel;

        this.shortLabel = new Gtk.ShortcutLabel({
            disabled_text: 'New accelerator…',
            valign: Gtk.Align.CENTER,
            hexpand: false,
            vexpand: false
        });

        this.shortcutBox.append(this.shortLabel);

        // Bind signals
        this.connect('activated', this._onActivated.bind(this));
        this.bind_property('shortcut', this.shortLabel, 'accelerator', GObject.BindingFlags.DEFAULT);
        [this.shortcut] = this._settings.get_strv(this._key);

        this.add_suffix(this.shortcutBox);
    }

    isAcceleratorSet() {
        return Boolean(this.shortLabel.get_accelerator());
    }

    resetAccelerator() {
        this.saveShortcut(); // Clear shortcut
    }

    _onActivated(widget) {
        const ctl = new Gtk.EventControllerKey();

        const content = new Adw.StatusPage({
            title: 'New accelerator…',
            description: this._description,
            icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic'
        });

        this._editor = new Adw.Window({
            modal: true,
            hide_on_close: true,
            transient_for: widget.get_root(),
            width_request: 480,
            height_request: 320,
            content
        });

        this._editor.add_controller(ctl);
        ctl.connect('key-pressed', this._onKeyPressed.bind(this));
        this._editor.present();
    }

    _onKeyPressed(_widget, keyval, keycode, state) {
        let mask = state & Gtk.accelerator_get_default_mod_mask();
        mask &= ~Gdk.ModifierType.LOCK_MASK;

        if (!mask && keyval === Gdk.KEY_Escape) {
            this._editor.close();
            return Gdk.EVENT_STOP;
        }

        if (keyval === Gdk.KEY_BackSpace) {
            this.saveShortcut(); // Clear shortcut
            return Gdk.EVENT_STOP;
        }

        if (!this.isValidBinding(mask, keycode, keyval) || !this.isValidAccel(mask, keyval)) {
            return Gdk.EVENT_STOP;
        }

        this.saveShortcut(keyval, keycode, mask);
        return Gdk.EVENT_STOP;
    }

    saveShortcut(keyval, keycode, mask) {
        if (!keyval && !keycode) {
            this.shortcut = '';
        } else {
            this.shortcut = Gtk.accelerator_name_with_keycode(null, keyval, keycode, mask);
        }

        this.emit('changed', this.shortcut);
        this._settings.set_strv(this._key, [this.shortcut]);
        this._editor.destroy();
    }

    keyvalIsForbidden(keyval) {
        return [
            Gdk.KEY_Home,
            Gdk.KEY_Left,
            Gdk.KEY_Up,
            Gdk.KEY_Right,
            Gdk.KEY_Down,
            Gdk.KEY_Page_Up,
            Gdk.KEY_Page_Down,
            Gdk.KEY_End,
            Gdk.KEY_Tab,
            Gdk.KEY_KP_Enter,
            Gdk.KEY_Return,
            Gdk.KEY_Mode_switch
        ].includes(keyval);
    }

    isValidBinding(mask, keycode, keyval) {
        return !(mask === 0 || (mask === Gdk.ModifierType.SHIFT_MASK && keycode !== 0 &&
                 ((keyval >= Gdk.KEY_a && keyval <= Gdk.KEY_z) ||
                     (keyval >= Gdk.KEY_A && keyval <= Gdk.KEY_Z) ||
                     (keyval >= Gdk.KEY_0 && keyval <= Gdk.KEY_9) ||
                     (keyval === Gdk.KEY_space && mask === 0) || this.keyvalIsForbidden(keyval)))
        );
    }

    isValidAccel(mask, keyval) {
        return Gtk.accelerator_valid(keyval, mask) || (keyval === Gdk.KEY_Tab && mask !== 0);
    }
};

