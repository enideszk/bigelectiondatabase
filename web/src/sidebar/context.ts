/** What every sidebar section gets to render from. */

import type { ElectionMeta, Meta, UnitElection, UnitFile, UnitIndexEntry } from '../lib/types';
import type { AppState } from '../state';

export interface SidebarContext {
  meta: Meta;
  units: Map<string, UnitIndexEntry>;
  unit: UnitFile;
  election: ElectionMeta;
  /** This unit's results in the selected election, if any. */
  results: UnitElection | undefined;
  state: AppState;
  select: (unitId: string) => void;
  update: (patch: Partial<AppState>) => void;
}
