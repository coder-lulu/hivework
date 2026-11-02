# Login shells reset PATH in /etc/profile; keep the app interpreter and saved CLIs.
export PATH="/app/.venv/bin:${NPM_CONFIG_PREFIX:-$HOME/.local}/bin:$HOME/.local/bin:$HOME/.skillhub/bin:$PATH"
