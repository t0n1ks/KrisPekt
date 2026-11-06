import { DAY_MS, TRASH_DAYS } from '../core/constants';
import type { Notebook, Subject } from '../core/types';

/** The shelf split into what is on it and what is in the Trash. */
export interface ShelfPartition {
  subjects: Subject[];
  notebooks: Notebook[];
  trashedSubjects: Subject[];
  trashedNotebooks: Notebook[];
  /** Subjects in the Trash that still have a notebook on the shelf; see {@link TrashRules.partition}. */
  revived: Subject[];
}

/** What the Trash lists: subjects, and the notebooks that were not deleted along with theirs. */
export interface TrashListing {
  subjects: Subject[];
  notebooks: Notebook[];
}

/** Pure rules of the Trash. Records without `deletedAt` (all old ones) are not deleted. */
export class TrashRules {
  /** Days until a deleted item is removed for good, from 0 to 30; clocks can disagree. */
  static daysLeft(deletedAt: number, now: number): number {
    const left = Math.ceil((deletedAt + TRASH_DAYS * DAY_MS - now) / DAY_MS);
    return Math.min(TRASH_DAYS, Math.max(0, left));
  }

  /** Whether an item has been in the Trash for its full 30 days. */
  static isExpired(deletedAt: number, now: number): boolean {
    return now - deletedAt >= TRASH_DAYS * DAY_MS;
  }

  /**
   * Splits stored records. A restored backup can bring a subject's deletion onto a device where a
   * notebook of that subject is still in use. That notebook would vanish from view (the shelf lists
   * notebooks by subject), so such a subject counts as not deleted.
   */
  static partition(subjects: readonly Subject[], notebooks: readonly Notebook[]): ShelfPartition {
    const inUse = new Set(notebooks.filter((nb) => nb.deletedAt === undefined).map((nb) => nb.subjectId));
    const revived = subjects.filter((s) => s.deletedAt !== undefined && inUse.has(s.id));
    const isTrashed = (s: Subject): boolean => s.deletedAt !== undefined && !revived.includes(s);
    return {
      subjects: subjects.filter((s) => !isTrashed(s)),
      notebooks: notebooks.filter((nb) => nb.deletedAt === undefined),
      trashedSubjects: subjects.filter(isTrashed),
      trashedNotebooks: notebooks.filter((nb) => nb.deletedAt !== undefined),
      revived,
    };
  }

  /**
   * What the Trash shows, newest first. A notebook deleted with its subject goes under that subject,
   * unless the subject is no longer in the Trash: then it stands on its own and nothing is out of reach.
   */
  static listing(subjects: readonly Subject[], notebooks: readonly Notebook[]): TrashListing {
    const trashed = new Set(subjects.map((s) => s.id));
    const newestFirst = <T extends { deletedAt?: number }>(a: T, b: T): number =>
      (b.deletedAt ?? 0) - (a.deletedAt ?? 0);
    return {
      subjects: [...subjects].sort(newestFirst),
      notebooks: notebooks
        .filter((nb) => !nb.deletedWithSubject || !trashed.has(nb.subjectId))
        .sort(newestFirst),
    };
  }
}
