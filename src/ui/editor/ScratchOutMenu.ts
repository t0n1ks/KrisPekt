import { SCRATCH_LEVEL_NAMES } from '../../core/constants';
import type { Preferences, ScratchLevel } from '../../core/types';
import type { I18n, TextKey } from '../../i18n/I18n';
import type { MenuEntry } from '../dialogs/Menu';

const LEVEL_LABELS: Record<ScratchLevel, TextKey> = {
  low: 'scratchLevelLow',
  normal: 'scratchLevelNormal',
  high: 'scratchLevelHigh',
};

/** The scratch-out settings in the editor's ⋯ menu: on or off, and how readily it triggers. */
export class ScratchOutMenu {
  constructor(
    private readonly i18n: I18n,
    private readonly prefs: Preferences,
    private readonly changed: (message: string) => void,
  ) {}

  /** The label of the entry that opens this menu: the name and what it is set to. */
  summary(): string {
    const { i18n, prefs } = this;
    const state = prefs.scratch.on ? LEVEL_LABELS[prefs.scratch.level] : 'scratchOffShort';
    return i18n.t('scratchOut') + ' · ' + i18n.t(state);
  }

  /** The menu's entries; the levels mean nothing while it is off, so they are greyed out then. */
  entries(): MenuEntry[] {
    const { i18n, prefs } = this;
    const levels = SCRATCH_LEVEL_NAMES.map((level): MenuEntry => ({
      label: i18n.t(LEVEL_LABELS[level]),
      check: prefs.scratch.level === level,
      disabled: !prefs.scratch.on,
      onClick: () => this.setLevel(level),
    }));
    const toggle: MenuEntry = {
      label: i18n.t('scratchOut'),
      icon: 'scribble',
      check: prefs.scratch.on,
      onClick: () => this.toggle(),
    };
    return [toggle, '-', ...levels];
  }

  private toggle(): void {
    const { prefs, i18n } = this;
    prefs.scratch.on = !prefs.scratch.on;
    this.changed(i18n.t(prefs.scratch.on ? 'scratchOn' : 'scratchOff'));
  }

  private setLevel(level: ScratchLevel): void {
    const { prefs, i18n } = this;
    prefs.scratch.level = level;
    this.changed(i18n.t('scratchLevelSet', { level: i18n.t(LEVEL_LABELS[level]) }));
  }
}
