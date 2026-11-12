"""Modes de fonctionnement de l'agent (AUDIT-ARCH-001).

Valeur partagée par les schémas, les services et l'agent : elle vit ici, hors de
`app.services`, pour que `app.schemas` ne dépende d'aucun service. Le stockage du réglage
reste dans `app.services.agent_settings`.
"""

from enum import StrEnum


class AgentMode(StrEnum):
    ASSISTED = "assisted"
    AUTO = "auto"
    MANUAL = "manual"


DEFAULT_MODE = AgentMode.ASSISTED
