/** What every sidebar section gets to render from. */

import type { ElectionMeta, IsoDate, Meta, UnitElection, UnitFile, UnitIndexEntry } from '../lib/types';
import type { AppState } from '../state';

export interface SidebarContext {
  meta: Meta;
  units: Map<string, UnitIndexEntry>;
  unit: UnitFile;
  /** The selected election; undefined while no election is loaded at all. */
  election: ElectionMeta | undefined;
  /** The date everything is described at: the election's date, or today. */
  date: IsoDate;
  /** This unit's results in the selected election, if any. */
  results: UnitElection | undefined;
  state: AppState;
  select: (unitId: string) => void;
  update: (patch: Partial<AppState>) => void;
  /** Nothing is selected: the panel shows the national results (no close button). */
  isDefault: boolean;
  /** The national results include votes cast by mail, which can be left out (state.postal). */
  hasMail: boolean;
}
