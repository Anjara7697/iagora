/** Les décisions modifient aussi les compteurs affichés hors de la file. */
export const WORK_QUEUE_CHANGED = "iagora:work-queue-changed";

export function notifyWorkQueueChanged() {
  window.dispatchEvent(new Event(WORK_QUEUE_CHANGED));
}
