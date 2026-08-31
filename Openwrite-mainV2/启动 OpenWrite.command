#!/bin/zsh

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR" || exit 1

is_compatible_python() {
  "$1" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1
}

PYTHON_BIN=""
for candidate in \
  "$ROOT_DIR/../../bin/python" \
  "$ROOT_DIR/bin/python" \
  "$ROOT_DIR/.venv/bin/python" \
  "$ROOT_DIR/.venv312/bin/python" \
  python3.13 python3.12 python3.11 python3.10 python3 \
  /opt/homebrew/bin/python3 /usr/local/bin/python3
do
  if command -v "$candidate" >/dev/null 2>&1 && is_compatible_python "$candidate"; then
    PYTHON_BIN="$candidate"
    break
  fi
done

if [[ -z "$PYTHON_BIN" ]]; then
  echo "[OpenWrite] 未找到 Python 3.10 或更高版本。"
  echo "请先从 https://www.python.org/downloads/macos/ 安装 Python，然后再次双击此文件。"
  echo
  read "?按回车键退出……"
  exit 2
fi

if [[ -f "$ROOT_DIR/tools/desktop_launcher.py" ]]; then
  "$PYTHON_BIN" -u "$ROOT_DIR/tools/desktop_launcher.py" "$@"
else
  "$PYTHON_BIN" -u -m tools.desktop_launcher "$@"
fi
launch_status=$?
if [[ $launch_status -ne 0 ]]; then
  echo
  read "?启动未完成，按回车键退出……"
fi
exit $launch_status
