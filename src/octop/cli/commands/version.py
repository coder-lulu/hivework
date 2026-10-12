"""octop version command."""

from __future__ import annotations

import click

from octop.branding import brand_name


@click.command("version", help=f"Show the installed {brand_name()} version.")
def version() -> None:
    """Show the installed octop version."""
    try:
        from importlib.metadata import version as _v

        v = _v("octop")
    except Exception:
        v = "unknown"
    click.echo(f"{brand_name()} v{v}")
