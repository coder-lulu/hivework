"""Generated setup credentials must always satisfy the login password policy."""

from types import SimpleNamespace

from octop.api.routers import setup
from octop.infra.users.password import validate_password_policy


def test_generated_password_has_letters_and_digits_even_if_random_part_has_no_digits(
    monkeypatch,
) -> None:
    server = SimpleNamespace(
        services=SimpleNamespace(config=SimpleNamespace(require_setup_password=False))
    )
    monkeypatch.setattr(setup.secrets, "token_urlsafe", lambda _: "x" * 43)

    password = setup._resolve_admin_password(server, None)

    validate_password_policy(password)
    assert len(password) >= 43
