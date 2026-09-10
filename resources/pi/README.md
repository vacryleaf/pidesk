# resources/pi

打包期注入的 pi 独立二进制(`pi` / Windows 为 `pi.exe`)与 `pi-manifest.json`(版本、平台、sha256、来源)。
由 `scripts/fetch-pi.sh` 生成:本地注入 `PI_LOCAL_BIN=<pi 路径> bash scripts/fetch-pi.sh <platform>`,或直接运行脚本从上游 release 下载并按 SHA256SUMS 校验。
构建时经 electron-builder `extraResources` 映射为应用内 `pi/` 目录(`pi-manifest.json` 用于运行期版本比对)。
