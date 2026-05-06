export interface WorkerSlot {
  name: string;
  role: string;
  busy: boolean;
  taskCount: number;
}

export interface RoleRouterOptions {
  workers: WorkerSlot[];
}

export interface PickOpts {
  excludeBusy?: boolean;
}

export interface RoleRouter {
  pickWorker(role: string, opts?: PickOpts): WorkerSlot | null;
  pickAnyWorker(opts?: PickOpts): WorkerSlot | null;
  markBusy(worker_name: string): void;
  markIdle(worker_name: string): void;
  incrementTaskCount(worker_name: string): void;
  refreshWorkers(workers: WorkerSlot[]): void;
}

function cloneSlot(slot: WorkerSlot): WorkerSlot {
  return {
    name: slot.name,
    role: slot.role,
    busy: slot.busy,
    taskCount: slot.taskCount,
  };
}

export function createRoleRouter(opts: RoleRouterOptions): RoleRouter {
  let slots: WorkerSlot[] = (opts.workers ?? []).map(cloneSlot);

  function findIndex(worker_name: string): number {
    return slots.findIndex((s) => s.name === worker_name);
  }

  function pickFromCandidates(
    candidates: { slot: WorkerSlot; index: number }[],
  ): WorkerSlot | null {
    if (candidates.length === 0) return null;
    let bestCount = candidates[0].slot.taskCount;
    let bestIndex = candidates[0].index;
    let bestSlot = candidates[0].slot;
    for (let i = 1; i < candidates.length; i++) {
      const c = candidates[i];
      if (
        c.slot.taskCount < bestCount ||
        (c.slot.taskCount === bestCount && c.index < bestIndex)
      ) {
        bestCount = c.slot.taskCount;
        bestIndex = c.index;
        bestSlot = c.slot;
      }
    }
    return cloneSlot(bestSlot);
  }

  function pickWorker(role: string, opts?: PickOpts): WorkerSlot | null {
    const excludeBusy = opts?.excludeBusy === true;
    const candidates: { slot: WorkerSlot; index: number }[] = [];
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (slot.role !== role) continue;
      if (excludeBusy && slot.busy) continue;
      candidates.push({ slot, index: i });
    }
    return pickFromCandidates(candidates);
  }

  function pickAnyWorker(opts?: PickOpts): WorkerSlot | null {
    const excludeBusy = opts?.excludeBusy === true;
    const candidates: { slot: WorkerSlot; index: number }[] = [];
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (excludeBusy && slot.busy) continue;
      candidates.push({ slot, index: i });
    }
    return pickFromCandidates(candidates);
  }

  function markBusy(worker_name: string): void {
    const i = findIndex(worker_name);
    if (i < 0) return;
    slots[i].busy = true;
  }

  function markIdle(worker_name: string): void {
    const i = findIndex(worker_name);
    if (i < 0) return;
    slots[i].busy = false;
  }

  function incrementTaskCount(worker_name: string): void {
    const i = findIndex(worker_name);
    if (i < 0) return;
    slots[i].taskCount += 1;
  }

  function refreshWorkers(workers: WorkerSlot[]): void {
    slots = (workers ?? []).map(cloneSlot);
  }

  return {
    pickWorker,
    pickAnyWorker,
    markBusy,
    markIdle,
    incrementTaskCount,
    refreshWorkers,
  };
}
