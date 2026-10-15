"""Limitation des tentatives de connexion (force brute).

Fenêtre glissante en mémoire, par couple (adresse IP, identifiant). Avec plusieurs instances du
backend, chacune compte de son côté : la limite réelle est multipliée par le nombre d'instances,
ce qui reste dissuasif. Un compteur partagé (Redis) viendra si le besoin se confirme.
"""

import time
from collections import defaultdict, deque

MAX_FAILURES = 5
WINDOW_SECONDS = 15 * 60


class LoginLimiter:
    def __init__(self, max_failures: int = MAX_FAILURES, window: int = WINDOW_SECONDS) -> None:
        self.max_failures = max_failures
        self.window = window
        self._failures: dict[str, deque[float]] = defaultdict(deque)

    @staticmethod
    def key(ip: str, username: str) -> str:
        return f"{ip}|{username.strip().lower()}"

    def _prune(self, key: str, now: float) -> deque[float]:
        events = self._failures[key]
        while events and now - events[0] > self.window:
            events.popleft()
        if not events:
            self._failures.pop(key, None)
        return events

    def retry_after(self, key: str, now: float | None = None) -> int:
        """Secondes à attendre avant un nouvel essai (0 si autorisé)."""
        now = time.monotonic() if now is None else now
        events = self._prune(key, now)
        if len(events) < self.max_failures:
            return 0
        return max(1, int(self.window - (now - events[0])))

    def record_failure(self, key: str, now: float | None = None) -> None:
        self._failures[key].append(time.monotonic() if now is None else now)

    def reset(self, key: str) -> None:
        self._failures.pop(key, None)


limiter = LoginLimiter()
