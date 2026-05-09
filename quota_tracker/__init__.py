"""quota_tracker package."""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("quota-tracker")
except PackageNotFoundError:
    __version__ = "dev"

__all__ = ["__version__"]
