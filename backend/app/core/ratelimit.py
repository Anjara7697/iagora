"""Limitation des tentatives de connexion (force brute, AUDIT-SEC-005).

Trois fenêtres glissantes de 15 minutes, en mémoire :
- couple (adresse, identifiant) : 5 échecs ;
- identifiant, toutes adresses : 20 échecs (attaque répartie sur de nombreuses adresses) ;
- adresse, tous identifiants : 50 échecs (pulvérisation de mots de passe).

Le premier seuil atteint bloque ; chaque blocage est journalisé, avec une empreinte de
l'identifiant (jamais l'identifiant lui-même). Les compteurs vivent dans le processus : une seule
instance du backend est déployée (`deploy/compose.prod.yml`) ; avec plusieurs, chaque instance
compterait de son côté et un compteur partagé (Redis) deviendrait nécessaire.
"""

import hashlib
import logging
import time
from collections import defaultdict, deque

logger = logging.getLogger(__name__)

WINDOW_SECONDS = 15 * 60
MAX_FAILURES = 5  # couple adresse + identifiant
MAX_FAILURES_PER_USERNAME = 20
MAX_FAILURES_PER_IP = 50


def _fingerprint(username: str) -> str:
    return hashlib.sha256(username.encode()).hexdigest()[:12]


class LoginLimiter:
    def __init__(
        self,
        max_failures: int = MAX_FAILURES,
        window: int = WINDOW_SECONDS,
        per_username: int = MAX_FAILURES_PER_USERNAME,
        per_ip: int = MAX_FAILURES_PER_IP,
    ) -> None:
        self.window = window
        self.limits = {"pair": max_failures, "user": per_username, "ip": per_ip}
        self._failures: dict[str, deque[float]] = defaultdict(deque)

    @staticmethod
    def _keys(ip: str, username: str) -> dict[str, str]:
        name = username.strip().lower()
        return {"pair": f"pair|{ip}|{name}", "user": f"user|{name}", "ip": f"ip|{ip}"}

    def _prune(self, key: str, now: float) -> deque[float]:
        events = self._failures[key]
        while events and now - events[0] > self.window:
            events.popleft()
        if not events:
            self._failures.pop(key, None)
        return events

    def retry_after(self, ip: str, username: str, now: float | None = None) -> int:
        """Secondes à attendre avant un nouvel essai (0 si autorisé)."""
        now = time.monotonic() if now is None else now
        wait = 0
        for kind, key in self._keys(ip, username).items():
            events = self._prune(key, now)
            if len(events) >= self.limits[kind]:
                wait = max(wait, max(1, int(self.window - (now - events[0]))))
        return wait

    def record_failure(self, ip: str, username: str, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        for kind, key in self._keys(ip, username).items():
            events = self._failures[key]
            events.append(now)
            if len(events) == self.limits[kind]:
                logger.warning(
                    "Connexions bloquées 15 min (%s) : adresse %s, identifiant #%s",
                    kind,
                    ip,
                    _fingerprint(username.strip().lower()),
                )

    def reset(self, ip: str, username: str) -> None:
        """Après une connexion réussie : le compteur par adresse est conservé (une adresse qui
        pulvérise ne s'efface pas en se connectant à son propre compte)."""
        keys = self._keys(ip, username)
        self._failures.pop(keys["pair"], None)
        self._failures.pop(keys["user"], None)

    def clear(self) -> None:
        self._failures.clear()


limiter = LoginLimiter()
