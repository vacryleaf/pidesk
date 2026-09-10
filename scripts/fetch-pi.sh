#!/usr/bin/env bash
# fetch-pi.sh —— 获取 pi 独立二进制并生成 resources/pi/pi-manifest.json
# 双模式:
#   本地模式(PI_LOCAL_BIN 非空):复制本地文件 → 现算 sha256 → 写清单(离线/CI 注入路径)
#   远端模式(默认):下载 release 资产 + SHA256SUMS → 校验 → 解包 → 写清单
# 用法:bash scripts/fetch-pi.sh [platform]   platform 省略时按 uname 推断
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="${ROOT}/resources/pi"

# 版本与仓库(与上游 tag 对齐,可用环境变量覆盖)
PI_VERSION="${PI_VERSION:-0.85.1}"
PI_REPO="${PI_REPO:-earendil-works/pi}"
# 远端下载前缀覆盖:私有镜像/离线缓存可设 PI_RELEASE_MIRROR
PI_RELEASE_MIRROR="${PI_RELEASE_MIRROR:-https://github.com}"

detect_platform() {  # 按 uname 推断平台串
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "${os}" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    MINGW*|MSYS*|CYGWIN*) os=windows ;;
    *) echo "不支持的平台系统:${os}" >&2; exit 1 ;;
  esac
  case "${arch}" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) echo "不支持的架构:${arch}" >&2; exit 1 ;;
  esac
  echo "${os}-${arch}"
}

PLATFORM="${1:-$(detect_platform)}"
case "${PLATFORM}" in
  darwin-arm64|darwin-x64|linux-arm64|linux-x64|windows-arm64|windows-x64) ;;
  *) echo "非法平台参数:${PLATFORM}" >&2; exit 1 ;;
esac

# Windows 平台二进制后缀不同
case "${PLATFORM}" in
  windows-*) BIN_NAME="pi.exe" ;;
  *) BIN_NAME="pi" ;;
esac

sha256_of() {  # 兼容 Linux(sha256sum)与 macOS(shasum)
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

write_manifest() {  # $1=sha256 $2=sourceUrl
  printf '{"version":"%s","platform":"%s","sha256":"%s","sourceUrl":"%s"}\n' \
    "${PI_VERSION}" "${PLATFORM}" "$1" "$2" >"${DEST_DIR}/pi-manifest.json"
}

mkdir -p "${DEST_DIR}"

# ---------- 本地模式 ----------
if [ -n "${PI_LOCAL_BIN:-}" ]; then
  [ -f "${PI_LOCAL_BIN}" ] || { echo "PI_LOCAL_BIN 指向的文件不存在:${PI_LOCAL_BIN}" >&2; exit 1; }
  install -m 0755 "${PI_LOCAL_BIN}" "${DEST_DIR}/${BIN_NAME}"
  SUM="$(sha256_of "${DEST_DIR}/${BIN_NAME}")"
  write_manifest "${SUM}" "local:${PI_LOCAL_BIN} (v${PI_VERSION})"
  echo "本地模式完成:${DEST_DIR}/${BIN_NAME}"
  echo "sha256:${SUM}"
  echo "清单:${DEST_DIR}/pi-manifest.json"
  exit 0
fi

# ---------- 远端模式(默认,本卡不执行) ----------
BASE_URL="${PI_RELEASE_MIRROR%/}/${PI_REPO}/releases/download/v${PI_VERSION}"
case "${PLATFORM}" in
  windows-*) ARCHIVE="pi-${PLATFORM}.zip" ;;
  *) ARCHIVE="pi-${PLATFORM}.tar.gz" ;;
esac

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "下载资产:${BASE_URL}/${ARCHIVE}"
curl -fSL --retry 3 -o "${TMP_DIR}/${ARCHIVE}" "${BASE_URL}/${ARCHIVE}"
echo "下载校验清单:${BASE_URL}/SHA256SUMS"
curl -fSL --retry 3 -o "${TMP_DIR}/SHA256SUMS" "${BASE_URL}/SHA256SUMS"

# 校验:tarball/zip 的 sha256 必须与 SHA256SUMS 一致,不符即拒绝
EXPECTED="$(awk -v a="${ARCHIVE}" '$2==a || $2=="*"a {print $1}' "${TMP_DIR}/SHA256SUMS")"
[ -n "${EXPECTED}" ] || { echo "SHA256SUMS 中未找到 ${ARCHIVE}" >&2; exit 1; }
ACTUAL="$(sha256_of "${TMP_DIR}/${ARCHIVE}")"
[ "${EXPECTED}" = "${ACTUAL}" ] || {
  echo "sha256 校验失败:期望 ${EXPECTED} 实际 ${ACTUAL}" >&2
  exit 1
}

# 解包
mkdir -p "${TMP_DIR}/x"
case "${PLATFORM}" in
  windows-*) unzip -q "${TMP_DIR}/${ARCHIVE}" -d "${TMP_DIR}/x" ;;
  *) tar -xzf "${TMP_DIR}/${ARCHIVE}" -C "${TMP_DIR}/x" ;;
esac

BIN_PATH="$(find "${TMP_DIR}/x" -type f -name "${BIN_NAME}" | head -n 1)"
[ -n "${BIN_PATH}" ] || { echo "包内未找到 ${BIN_NAME}" >&2; exit 1; }
install -m 0755 "${BIN_PATH}" "${DEST_DIR}/${BIN_NAME}"

SUM="$(sha256_of "${DEST_DIR}/${BIN_NAME}")"
write_manifest "${SUM}" "${BASE_URL}/${ARCHIVE}"
echo "远端模式完成:${DEST_DIR}/${BIN_NAME}"
echo "sha256:${SUM}"
echo "清单:${DEST_DIR}/pi-manifest.json"
