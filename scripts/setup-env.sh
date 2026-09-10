#!/usr/bin/env bash
# pidesk 开发环境自动修复:检测→安装→验证→循环
# 用法: scripts/setup-env.sh
#   - 全程无 sudo 可自动修复的:自动修(electron 二进制、pnpm 路径)
#   - 需要系统库的:尝试 sudo -n 非交互安装;失败则打印待执行命令并以退出码 2 结束
#   - 已知环境问题的新案例:修复动作沉淀进本脚本(AGENTS.md 纪律)
set -uo pipefail

PNPM="/home/harry/.npm-global/bin/pnpm"
ELECTRON_DIR="apps/desktop/node_modules/electron"
NEED_SUDO_PKGS=""
FIXED=""
MAX_ROUNDS=3

log() { echo "[setup-env] $*"; }
fail() { echo "[setup-env][待人工] $*"; }

has_lib() { ldconfig -p 2>/dev/null | grep -q "$1"; }

# ---------- 检测与修复 ----------
round=0
while [ $round -lt $MAX_ROUNDS ]; do
  round=$((round + 1))
  log "==== 第 $round 轮检测 ===="
  PROBLEM=0

  # 1. pnpm 可用性(PATH 内损坏 → 用绝对路径兜底即可,仅提示)
  [ -x "$PNPM" ] || { fail "找不到 $PNPM,请安装 pnpm 到 ~/.npm-global"; PROBLEM=1; }

  # 2. node 存在
  command -v node > /dev/null || { fail "node 不可用"; PROBLEM=1; }

  # 3. 依赖安装(node_modules)
  if [ ! -d node_modules ]; then
    log "修复:pnpm install(首次)"
    "$PNPM" install >> /tmp/setup-env-install.log 2>&1 || { fail "pnpm install 失败,详见 /tmp/setup-env-install.log"; PROBLEM=1; }
    FIXED="$FIXED\n  - pnpm install"
  fi

  # 4. Electron 二进制(postinstall 可能被跳过)
  if [ ! -f "$ELECTRON_DIR/dist/electron" ]; then
    log "修复:安装 Electron 二进制(npmmirror)"
    (cd "$ELECTRON_DIR" && ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node install.js >> /tmp/setup-env-electron.log 2>&1) \
      || (cd "$ELECTRON_DIR" && node install.js >> /tmp/setup-env-electron.log 2>&1) \
      || { fail "Electron 二进制安装失败,详见 /tmp/setup-env-electron.log"; PROBLEM=1; }
    FIXED="$FIXED\n  - Electron 二进制"
  fi

  # 5. Electron 运行系统库(ldd 检测缺失)
  MISSING_LIBS=""
  if [ -f "$ELECTRON_DIR/dist/electron" ]; then
    for lib in $(ldd "$ELECTRON_DIR/dist/electron" 2>/dev/null | grep 'not found' | awk '{print $1}'); do
      MISSING_LIBS="$MISSING_LIBS $lib"
    done
  fi
  if [ -n "$MISSING_LIBS" ]; then
    log "检测到缺系统库:$MISSING_LIBS"
    # 库名 → apt 包名映射(Electron 常见集)
    PKGS=""
    case "$MISSING_LIBS" in *libnspr4*) PKGS="$PKGS libnspr4";; esac
    case "$MISSING_LIBS" in *libnss3*) PKGS="$PKGS libnss3";; esac
    case "$MISSING_LIBS" in *libatk*) PKGS="$PKGS libatk1.0-0 libatk-bridge2.0-0";; esac
    case "$MISSING_LIBS" in *libcups*) PKGS="$PKGS libcups2";; esac
    case "$MISSING_LIBS" in *libdrm*) PKGS="$PKGS libdrm2";; esac
    case "$MISSING_LIBS" in *libxkbcommon*) PKGS="$PKGS libxkbcommon0";; esac
    case "$MISSING_LIBS" in *libXcomposite*|*libxcomposite*) PKGS="$PKGS libxcomposite1";; esac
    case "$MISSING_LIBS" in *libXdamage*|*libxdamage*) PKGS="$PKGS libxdamage1";; esac
    case "$MISSING_LIBS" in *libXfixes*|*libxfixes*) PKGS="$PKGS libxfixes3";; esac
    case "$MISSING_LIBS" in *libXrandr*|*libxrandr*) PKGS="$PKGS libxrandr2";; esac
    case "$MISSING_LIBS" in *libgbm*) PKGS="$PKGS libgbm1";; esac
    case "$MISSING_LIBS" in *libasound*) PKGS="$PKGS libasound2t64";; esac
    case "$MISSING_LIBS" in *libgtk*) PKGS="$PKGS libgtk-3-0t64";; esac
    case "$MISSING_LIBS" in *libXss*|*libxss*) PKGS="$PKGS libxss1";; esac
    if [ -n "$PKGS" ]; then
      if sudo -n true 2>/dev/null; then
        log "修复:sudo 自动安装 $PKGS"
        sudo apt install -y $PKGS >> /tmp/setup-env-apt.log 2>&1 || { fail "apt 安装失败,详见 /tmp/setup-env-apt.log"; PROBLEM=1; }
        FIXED="$FIXED\n  - 系统库:$PKGS"
      else
        NEED_SUDO_PKGS="$NEED_SUDO_PKGS $PKGS"
      fi
    else
      NEED_SUDO_PKGS="$NEED_SUDO_PKGS (未知库:$MISSING_LIBS,请手动确认 apt 包名)"
    fi
  fi

  # 5.5 /dev/shm 权限(Electron 共享内存需要 1777)
  SHM_MODE=$(stat -c %a /dev/shm 2>/dev/null || echo "0")
  [ "$SHM_MODE" != "1777" ] && {
    if sudo -n chmod 1777 /dev/shm 2>/dev/null; then
      log "修复:/dev/shm 权限 → 1777"
      FIXED="$FIXED\n  - /dev/shm 权限"
    else
      NEED_SUDO_PKGS="$NEED_SUDO_PKGS (chmod 1777 /dev/shm)"
    fi
  }

# 6. DISPLAY(WSLg)
  [ -n "${DISPLAY:-}" ] || { fail "DISPLAY 未设置(WSLg 未启用?)——窗口无法显示"; PROBLEM=1; }

  # 循环判定
  if [ $PROBLEM -eq 0 ] && [ -z "$NEED_SUDO_PKGS" ]; then
    log "==== 全部就绪(经 $round 轮)===="
    [ -n "$FIXED" ] && echo -e "本轮修复:$FIXED"
    exit 0
  fi
  [ -n "$NEED_SUDO_PKGS" ] && break   # 需人工 sudo,不再空转
  log "仍有问题,下一轮..."
done

# ---------- 人工兜底 ----------
if [ -n "$NEED_SUDO_PKGS" ]; then
  fail "以下需要 sudo 安装(脚本无免密 sudo),请执行后重跑本脚本:"
  echo "  sudo apt install -y$NEED_SUDO_PKGS"
  exit 2
fi
fail "经 $MAX_ROUNDS 轮仍有未解决问题,见上方日志"
exit 1
