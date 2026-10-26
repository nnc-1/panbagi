// A page with unsaved work registers a guard; leaving it by Back or any link asks first.
let guard: (() => boolean) | null = null;

export const setLeaveGuard = (g: (() => boolean) | null) => void (guard = g);
export const mayLeave = () => !guard || guard();
