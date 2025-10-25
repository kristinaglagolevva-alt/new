"""Backend application package for Jira Integration Workflow."""

from importlib.metadata import version, PackageNotFoundError

__all__ = ["__version__"]

try:
    __version__ = version("jira-integration-backend")
except PackageNotFoundError:  # pragma: no cover - local dev without packaging
    __version__ = "0.1.0"
