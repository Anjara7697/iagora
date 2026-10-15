import os

# Les tests déclenchent l'agent eux-mêmes ; le déclenchement automatique et l'exécuteur de relances
# ont leurs propres tests, qui les activent explicitement.
os.environ.setdefault("AGENT_AUTO_REPLY", "false")
os.environ.setdefault("FOLLOW_UP_WORKER_ENABLED", "false")
