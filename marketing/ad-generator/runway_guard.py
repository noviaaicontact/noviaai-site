"""
Garde-fou Runway — aucun crédit consommé sans approbation explicite.

Approbation via :
  - variable d'environnement RUNWAY_ALLOW=1
  - flag CLI --allow-runway
  - paramètre allow_runway=True dans le code

Sans approbation, generate_video_from_image() lève RunwayNotApproved.
"""
from __future__ import annotations

import os

APPROVAL_ENV = "RUNWAY_ALLOW"


class RunwayNotApproved(RuntimeError):
    """Runway bloqué — approbation utilisateur requise."""

    DEFAULT_MSG = (
        "Runway BLOQUE — consommation de credits refusee sans votre approbation.\n"
        "Pour autoriser : ajoutez --allow-runway a la commande\n"
        "  ou RUNWAY_ALLOW=1 dans l'environnement."
    )

    def __init__(self, message: str | None = None) -> None:
        super().__init__(message or self.DEFAULT_MSG)


def is_runway_allowed() -> bool:
    v = os.environ.get(APPROVAL_ENV, "").strip().lower()
    return v in ("1", "true", "yes", "oui", "on")


def require_runway_approval(*, source: str = "") -> None:
    if not is_runway_allowed():
        msg = RunwayNotApproved.DEFAULT_MSG
        if source:
            msg = f"{msg}\n(Appel depuis : {source})"
        raise RunwayNotApproved(msg)


def grant_runway_approval() -> None:
    """Active l'approbation pour la session en cours."""
    os.environ[APPROVAL_ENV] = "1"


def revoke_runway_approval() -> None:
    os.environ.pop(APPROVAL_ENV, None)
