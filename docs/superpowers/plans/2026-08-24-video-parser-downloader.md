# Video Parser Downloader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 SD 工具箱增加一个可实际解析并下载抖音、B 站单个公开视频的工具，同时提供匿名会话隔离、SSRF 防护、短时解析凭证、限流、任务进度、FFmpeg 合并和自动清理。

**Architecture:** 新建单进程 FastAPI 服务 `video-downloader`，只让服务器保存平台 URL、格式 ID 和媒体临时文件；React 前端通过同源 `/video-api/` 调用稳定的 `/api/v1` 契约。解析与下载分为两步，解析凭证绑定匿名 HttpOnly Cookie；下载由内存队列执行，生产环境固定一个 Uvicorn worker、最多两个并发任务。

**Tech Stack:** Python 3.11、FastAPI 0.141.1、yt-dlp 2026.8.19、FFmpeg、Pydantic Settings、itsdangerous、pytest；React 18、TypeScript、Vite、Tailwind CSS、Vitest、Testing Library；Nginx/宝塔。

---

## 实施前约束

- 当前工作树不是干净状态。`SD/components/ToolWindow.tsx`、`SD/public/sitemap.xml`、`.env.production.example` 和 `nginx.conf` 已有用户修改；开始每个相关任务前先运行 `git diff -- <path>`，使用上下文补丁保留原改动，不覆盖整份文件。
- 任何提交只暂存本任务明确列出的文件。上述四个共享脏文件不得整文件 `git add`；无法可靠拆分时保留为未暂存状态，并在交付中说明。
- 不把真实 Cookie、真实签名密钥、平台媒体 URL、解析凭证、任务会话 Cookie 或下载临时文件写入仓库和日志。
- 默认自动化测试不访问抖音或 B 站。平台行为由伪造的 yt-dlp 元数据和下载器测试替身覆盖。
- 第一版只支持抖音单视频、B 站单视频单 P。不要顺手加入合集、多 P、番剧、会员内容、登录态上传、字幕、音频提取或批量下载。

## 固定 API 与默认值

所有业务接口位于 `/api/v1`，健康接口为 `/health`：

```text
GET    /health
POST   /api/v1/parse
POST   /api/v1/downloads
GET    /api/v1/downloads/{job_id}
DELETE /api/v1/downloads/{job_id}
GET    /api/v1/downloads/{job_id}/file
```

默认配置必须保持：会话 3600 秒、解析凭证 300 秒、完成文件 1800 秒、最大时长 7200 秒、最大文件 2147483648 字节、全局下载并发 2、单 IP 活跃任务 1、解析 10 次/分钟/IP、下载 3 次/小时/IP、短链接最多 3 次重定向、队列最多 8 个等待任务。

稳定错误码固定为：`INVALID_URL`、`MULTIPLE_URLS_NOT_SUPPORTED`、`UNSUPPORTED_PLATFORM`、`PRIVATE_OR_UNAVAILABLE`、`PLAYLIST_NOT_SUPPORTED`、`COOKIE_REQUIRED`、`RATE_LIMITED`、`DURATION_LIMIT`、`FILE_SIZE_LIMIT`、`QUEUE_FULL`、`DEPENDENCY_UNAVAILABLE`、`EXTRACTOR_TEMPORARILY_UNAVAILABLE`、`MERGE_FAILED`、`JOB_NOT_FOUND`、`JOB_EXPIRED`。

## Task 1: 创建服务骨架、配置和健康契约

**Files:**

- Create: `video-downloader/pyproject.toml`
- Create: `video-downloader/requirements.txt`
- Create: `video-downloader/video_downloader/__init__.py`
- Create: `video-downloader/video_downloader/config.py`
- Create: `video-downloader/video_downloader/errors.py`
- Create: `video-downloader/video_downloader/models.py`
- Create: `video-downloader/video_downloader/dependencies.py`
- Create: `video-downloader/video_downloader/app.py`
- Create: `video-downloader/tests/conftest.py`
- Create: `video-downloader/tests/test_health.py`

- [ ] **Step 1: 写健康接口失败测试**

在 `tests/conftest.py` 提供隔离配置工厂，所有测试都把临时目录指向 `tmp_path`：

```python
from pathlib import Path

import pytest
from pydantic import SecretStr

from video_downloader.config import VideoSettings


@pytest.fixture
def settings(tmp_path: Path) -> VideoSettings:
    return VideoSettings(
        environment="test",
        signing_secret=SecretStr("test-signing-secret-that-is-long-enough"),
        temp_dir=tmp_path / "video-jobs",
        cookie_secure=True,
    )
```

在 `tests/test_health.py` 固定公开响应，不允许暴露路径或版本内部信息：

```python
from fastapi.testclient import TestClient

from video_downloader.app import create_app
from video_downloader.dependencies import DependencyStatus


class FakeDependencyProbe:
    def status(self) -> DependencyStatus:
        return DependencyStatus(
            yt_dlp=True,
            ffmpeg=False,
            douyin_cookie="missing",
        )


def test_health_reports_degraded_capabilities_without_paths(settings):
    app = create_app(settings=settings, dependency_probe=FakeDependencyProbe())
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "degraded",
        "capabilities": {
            "ytDlp": True,
            "ffmpeg": False,
            "douyinCookie": "missing",
        },
    }
    body = response.text.lower()
    assert "cookie_file" not in body
    assert str(settings.temp_dir).lower() not in body
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```powershell
cd E:\AI\gp\video-downloader
python -m pytest tests/test_health.py -q
```

Expected: FAIL，原因是 `video_downloader` 包或 `create_app` 尚不存在。

- [ ] **Step 3: 固定依赖并实现最小健康服务**

`pyproject.toml` 使用当前已核对的精确直接依赖：

```toml
[project]
name = "dream-chaser-video-downloader"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi==0.141.1",
  "uvicorn[standard]==0.52.4",
  "yt-dlp==2026.8.19",
  "pydantic-settings==2.15.0",
  "itsdangerous==2.2.0",
]

[project.optional-dependencies]
dev = [
  "httpx==0.28.1",
  "pytest==9.1.1",
  "pytest-asyncio==1.4.0",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
markers = ["live: opt-in tests that call real public platform URLs"]
```

`requirements.txt` 只列生产依赖，版本与 `pyproject.toml` 完全一致。`config.py` 定义 `VideoSettings(BaseSettings)`，环境变量前缀为 `VIDEO_`，字段和默认值如下：

```python
environment: Literal["development", "test", "production"] = "development"
signing_secret: SecretStr | None = None
temp_dir: Path = Path(tempfile.gettempdir()) / "sd-video-downloader"
cookie_secure: bool = True
cookie_name: str = "sd_video_session"
cookie_path: str = "/video-api/"
session_ttl_seconds: int = 3600
parse_token_ttl_seconds: int = 300
output_ttl_seconds: int = 1800
max_duration_seconds: int = 7200
max_file_bytes: int = 2147483648
global_download_concurrency: int = 2
per_ip_active_downloads: int = 1
parse_rate_limit: int = 10
parse_rate_window_seconds: int = 60
download_rate_limit: int = 3
download_rate_window_seconds: int = 3600
max_redirects: int = 3
max_queue_size: int = 8
trusted_proxies: str = "127.0.0.1/32,::1/128"
douyin_cookie_file: Path | None = None
ffmpeg_bin: str = "ffmpeg"
```

配置校验必须先把 `signing_secret`、`douyin_cookie_file` 的空字符串规范化为 `None`，再拒绝根目录、当前项目目录和用户主目录作为 `temp_dir`；生产环境必须要求至少 32 字符的 `signing_secret` 且 `cookie_secure=true`。开发/测试未配置签名密钥时，在 `create_app` 时生成仅对当前进程有效的随机密钥。

`errors.py` 定义 `ServiceError(code, message, http_status, retryable=False)`。`models.py` 创建统一 camelCase Pydantic 基类：

```python
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
    )
```

`dependencies.py` 定义不可变 `DependencyStatus` 和 `DependencyProbe.status()`：用 `importlib.util.find_spec("yt_dlp")` 检查库，用 `shutil.which`/三秒 `ffmpeg -version` 检查 FFmpeg；Cookie 仅返回 `configured`、`missing`、`invalid`。存在、可读、非空且包含 Netscape Cookie 文件头时为 `configured`，不得返回路径。

`app.py` 暂时只实现 `create_app(settings=None, dependency_probe=None)` 和 `/health`，并挂载 `ServiceError` 的统一 JSON 异常处理器：

```json
{"error":{"code":"DEPENDENCY_UNAVAILABLE","message":"视频解析依赖暂不可用，请稍后重试。","retryable":true}}
```

- [ ] **Step 4: 安装并运行测试**

Run:

```powershell
cd E:\AI\gp\video-downloader
python -m pip install -e ".[dev]"
python -m pytest tests/test_health.py -q
```

Expected: `1 passed`。

- [ ] **Step 5: 提交服务骨架**

```powershell
cd E:\AI\gp
git add -- video-downloader/pyproject.toml video-downloader/requirements.txt video-downloader/video_downloader video-downloader/tests/conftest.py video-downloader/tests/test_health.py
git commit -m "feat: scaffold video downloader service"
```

## Task 2: 实现 URL 提取、允许域和 SSRF 防护

**Files:**

- Create: `video-downloader/video_downloader/url_policy.py`
- Create: `video-downloader/tests/test_url_policy.py`

- [ ] **Step 1: 写 URL 策略失败测试**

测试至少覆盖下列完整输入矩阵：

```python
import pytest

from video_downloader.errors import ServiceError
from video_downloader.url_policy import UrlPolicy


PUBLIC_IPS = {
    "v.douyin.com": ["93.184.216.34"],
    "www.douyin.com": ["93.184.216.34"],
    "b23.tv": ["93.184.216.34"],
    "www.bilibili.com": ["93.184.216.34"],
}


class FakeResolver:
    def resolve(self, host: str) -> list[str]:
        return PUBLIC_IPS.get(host, ["127.0.0.1"])


class FakeRedirectTransport:
    def __init__(self, redirects: dict[str, str]):
        self.redirects = redirects

    def fetch_location(self, url: str, ip: str) -> str | None:
        assert ip == "93.184.216.34"
        return self.redirects.get(url)


def test_extracts_one_supported_url_from_share_text(settings):
    policy = UrlPolicy(settings, FakeResolver(), FakeRedirectTransport({}))
    result = policy.resolve("复制链接 http://v.douyin.com/abc/ 打开抖音")
    assert result.platform == "douyin"
    assert result.url == "https://v.douyin.com/abc/"


@pytest.mark.parametrize(
    ("text", "code"),
    [
        ("没有链接", "INVALID_URL"),
        ("https://example.com/video/1", "UNSUPPORTED_PLATFORM"),
        ("https://douyin.com.example.org/a", "UNSUPPORTED_PLATFORM"),
        ("https://user@www.bilibili.com/video/BV1", "INVALID_URL"),
        ("https://www.bilibili.com:8443/video/BV1", "INVALID_URL"),
        (
            "https://v.douyin.com/a https://www.bilibili.com/video/BV1",
            "MULTIPLE_URLS_NOT_SUPPORTED",
        ),
    ],
)
def test_rejects_invalid_input(settings, text, code):
    policy = UrlPolicy(settings, FakeResolver(), FakeRedirectTransport({}))
    with pytest.raises(ServiceError) as caught:
        policy.resolve(text)
    assert caught.value.code == code


def test_rejects_private_dns_answer(settings):
    class PrivateResolver:
        def resolve(self, host: str) -> list[str]:
            return ["10.0.0.8"]

    policy = UrlPolicy(settings, PrivateResolver(), FakeRedirectTransport({}))
    with pytest.raises(ServiceError) as caught:
        policy.resolve("https://b23.tv/private")
    assert caught.value.code == "INVALID_URL"


def test_validates_every_redirect_and_final_host(settings):
    start = "https://b23.tv/demo"
    final = "https://www.bilibili.com/video/BV1demo"
    policy = UrlPolicy(
        settings,
        FakeResolver(),
        FakeRedirectTransport({start: final}),
    )
    result = policy.resolve(start)
    assert result.url == final
    assert result.platform == "bilibili"
```

再增加四个专门测试：第 4 次重定向失败；重定向到 `localhost` 失败；IP 字面量失败；DNS 返回多个地址时只要任一地址属于私网/保留地址就整体失败。

- [ ] **Step 2: 运行 URL 测试并确认失败**

```powershell
cd E:\AI\gp\video-downloader
python -m pytest tests/test_url_policy.py -q
```

Expected: FAIL，`url_policy.py` 尚不存在。

- [ ] **Step 3: 实现可注入、可测试的 URL 策略**

`url_policy.py` 必须提供：

```python
@dataclass(frozen=True)
class ResolvedVideoUrl:
    platform: Literal["douyin", "bilibili"]
    url: str
```

同时定义 `DnsResolver.resolve(host: str) -> list[str]`、`RedirectTransport.fetch_location(url: str, ip: str) -> str | None`、`UrlPolicy.resolve(text: str) -> ResolvedVideoUrl`，以及生产构造器 `UrlPolicy.from_settings(settings) -> UrlPolicy`。Protocol 只描述依赖边界，生产构造器必须组装 `SocketDnsResolver` 与 `PinnedHttpsRedirectTransport`。

实现规则必须逐项落地：

1. 用受限 URL 正则从分享文本中提取候选，去除 `。，、；！？)]}】）》` 等尾随标点。
2. `http` 只对允许域升级为 `https`；其他协议直接拒绝。
3. 域名用标签边界匹配 `douyin.com`、`iesdouyin.com`、`bilibili.com`、`b23.tv`，使用 IDNA 规范化和小写比较。
4. 拒绝用户名、密码、片段、非 443 端口、IP 字面量和空主机。
5. 每一跳先解析全部 A/AAAA 地址；使用 `ipaddress.ip_address` 拒绝 unspecified、loopback、private、link-local、multicast、reserved 和非 global 地址。任何一个解析结果不安全时整跳失败。
6. 最多执行 `settings.max_redirects` 次跳转；每一跳重新运行完整校验，最终 URL 仍必须是允许平台域。
7. 生产 `PinnedHttpsRedirectTransport` 必须连接校验过的 IP，同时用原主机作为 TLS SNI、证书主机名和 `Host`；先发 HEAD，405/501 时改发 `Range: bytes=0-0` 的 GET，连接/读取超时 5 秒，最多读取 1 KiB，不自动跟随重定向。
8. 仅把最终允许 URL 交给 yt-dlp；后续提取器还要校验返回的 `webpage_url` 和 extractor key。

`SocketDnsResolver` 使用 `socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)` 并去重。`PinnedHttpsRedirectTransport` 使用标准库 socket/ssl/http.client 的小型连接类，不能先校验一次后再让另一个 DNS 查询决定连接地址。

- [ ] **Step 4: 运行策略测试**

```powershell
python -m pytest tests/test_url_policy.py -q
```

Expected: 全部 PASS；测试不能访问外网。

- [ ] **Step 5: 提交 URL 安全边界**

```powershell
cd E:\AI\gp
git add -- video-downloader/video_downloader/url_policy.py video-downloader/tests/test_url_policy.py
git commit -m "feat: validate video URLs against SSRF"
```

## Task 3: 归一化 yt-dlp 元数据与质量选项

**Files:**

- Create: `video-downloader/video_downloader/format_policy.py`
- Create: `video-downloader/video_downloader/extractor.py`
- Create: `video-downloader/tests/test_format_policy.py`
- Create: `video-downloader/tests/test_extractor.py`
- Modify: `video-downloader/video_downloader/models.py`

- [ ] **Step 1: 写格式归一化失败测试**

在 `test_format_policy.py` 使用固定元数据，断言客户端永远看不到原始 format ID：

```python
from video_downloader.format_policy import FormatPolicy


def test_groups_formats_and_pairs_video_only_with_audio(settings):
    formats = [
        {"format_id": "p720", "height": 720, "ext": "mp4", "vcodec": "avc1.64001f", "acodec": "mp4a.40.2", "filesize": 20_000_000, "tbr": 1800},
        {"format_id": "v1080", "height": 1080, "ext": "mp4", "vcodec": "avc1.640028", "acodec": "none", "filesize": 40_000_000, "tbr": 3000},
        {"format_id": "a1", "height": None, "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.2", "filesize": 4_000_000, "abr": 128},
    ]

    selections = FormatPolicy(settings.max_file_bytes).build("bilibili", formats)

    assert [item.public.label for item in selections] == ["1080P", "720P"]
    assert selections[0].public.requires_merge is True
    assert selections[0].public.has_audio is True
    assert selections[0].public.estimated_bytes == 44_000_000
    assert selections[0].selector == "v1080+a1"
    assert selections[0].public.id.startswith("q_")
    assert "v1080" not in selections[0].public.id
    assert selections[1].public.requires_merge is False


def test_discards_oversize_formats_and_fails_when_none_remain(settings):
    policy = FormatPolicy(max_file_bytes=100)
    formats = [{"format_id": "large", "height": 720, "ext": "mp4", "vcodec": "h264", "acodec": "aac", "filesize": 101}]
    assert policy.build("douyin", formats) == []
```

另测：同高度优先 MP4/H.264；未知大小返回 `None`；无音轨时 `hasAudio=false`；质量按高度降序；重复格式去重；质量 ID 对同一选择稳定、对不同选择不同。

- [ ] **Step 2: 写提取器失败测试**

`test_extractor.py` 用可注入 `ydl_factory`，断言选项和平台限制：

```python
import pytest

from video_downloader.errors import ServiceError
from video_downloader.extractor import YtDlpExtractor
from video_downloader.url_policy import ResolvedVideoUrl


class FakeYdl:
    def __init__(self, options, result):
        self.options = options
        self.result = result

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def extract_info(self, url, download):
        assert download is False
        return self.result


def test_extracts_single_bilibili_video_with_server_format_map(settings):
    result = {
        "extractor_key": "BiliBili",
        "webpage_url": "https://www.bilibili.com/video/BV1demo",
        "id": "BV1demo",
        "title": "演示视频",
        "uploader": "作者",
        "thumbnail": "https://i0.hdslb.com/demo.jpg",
        "duration": 120,
        "formats": [{"format_id": "p720", "height": 720, "ext": "mp4", "vcodec": "h264", "acodec": "aac", "filesize": 1000}],
    }
    captured = {}

    def factory(options):
        captured.update(options)
        return FakeYdl(options, result)

    extractor = YtDlpExtractor(settings, ydl_factory=factory)
    extracted = extractor.extract(ResolvedVideoUrl("bilibili", result["webpage_url"]))

    assert captured["noplaylist"] is True
    assert "Generic" not in captured["allowed_extractors"]
    assert extracted.video.platform == "bilibili"
    assert extracted.video.id == "BV1demo"
    assert list(extracted.format_map) == [extracted.video.qualities[0].id]


@pytest.mark.parametrize("entries", [[{"id": "1"}, {"id": "2"}], []])
def test_rejects_playlist_or_empty_entries(settings, entries):
    result = {"_type": "playlist", "extractor_key": "BiliBili", "entries": entries}
    extractor = YtDlpExtractor(settings, ydl_factory=lambda options: FakeYdl(options, result))
    with pytest.raises(ServiceError) as caught:
        extractor.extract(ResolvedVideoUrl("bilibili", "https://www.bilibili.com/video/BV1"))
    assert caught.value.code == "PLAYLIST_NOT_SUPPORTED"
```

再测超时长、无视频格式、extractor key 与平台不匹配、返回 `webpage_url` 越界、抖音 Cookie 只在平台为 Douyin 且文件有效时传入、常见 yt-dlp 错误到稳定错误码的映射。

- [ ] **Step 3: 运行两组测试并确认失败**

```powershell
cd E:\AI\gp\video-downloader
python -m pytest tests/test_format_policy.py tests/test_extractor.py -q
```

Expected: FAIL，格式策略和提取器尚不存在。

- [ ] **Step 4: 实现公开模型、内部选择和提取器**

`models.py` 新增 `QualityOption`、`VideoInfo`。字段通过 camelCase 输出：`estimated_bytes`、`requires_merge`、`has_audio` 分别序列化成 `estimatedBytes`、`requiresMerge`、`hasAudio`。

`format_policy.py` 定义：

```python
@dataclass(frozen=True)
class FormatSelection:
    public: QualityOption
    selector: str
    merge_extension: str | None
```

`FormatPolicy(max_file_bytes)` 提供 `build(platform: str, formats: list[dict[str, Any]]) -> list[FormatSelection]`。

选择规则按“有效高度 → MP4 容器 → H.264/AVC → 带音频单流 → 码率”排序；视频流无音频时配对最佳 M4A/AAC 音频，找不到则保留视频并标 `hasAudio=false`。大小使用 `filesize`，其次 `filesize_approx`，分离流相加；已知大小超过限制的选项不返回。公开质量 ID 为 `q_` 加服务端 HMAC/哈希摘要前 12 位，不拼接原 format ID。

`extractor.py` 定义内部对象：

```python
@dataclass(frozen=True)
class ExtractedVideo:
    normalized_url: str
    video: VideoInfo
    format_map: dict[str, FormatSelection]
```

`YtDlpExtractor` 本任务实现 `extract(target: ResolvedVideoUrl) -> ExtractedVideo`；Task 5 再新增完整的同步 `download(request: DownloadRequest, hooks: DownloadHooks) -> Path`，避免在中间提交留下占位方法。

本任务只创建并完整实现 `extract`，不提前声明未完成的下载方法。提取配置必须包含 `download=False`、`noplaylist=True`、`quiet=True`、`no_warnings=True`、`allowed_extractors=["Douyin", "BiliBili"]`，并禁用 Generic extractor。拒绝 `_type=playlist`、任何 `entries` 容器、多 P/多条目、超过时长和没有可用质量的结果。

yt-dlp 异常映射只发生在服务端：登录/私密/会员语义映射 `PRIVATE_OR_UNAVAILABLE`，抖音验证或 Cookie 语义映射 `COOKIE_REQUIRED`，平台临时网络/提取失败映射 `EXTRACTOR_TEMPORARILY_UNAVAILABLE`；前端只读取稳定错误码。

- [ ] **Step 5: 运行格式和提取测试**

```powershell
python -m pytest tests/test_format_policy.py tests/test_extractor.py -q
```

Expected: 全部 PASS。

- [ ] **Step 6: 提交元数据提取层**

```powershell
cd E:\AI\gp
git add -- video-downloader/video_downloader/models.py video-downloader/video_downloader/format_policy.py video-downloader/video_downloader/extractor.py video-downloader/tests/test_format_policy.py video-downloader/tests/test_extractor.py
git commit -m "feat: normalize public video formats"
```

## Task 4: 实现匿名会话、解析凭证、记录存储和限流

**Files:**

- Create: `video-downloader/video_downloader/security.py`
- Create: `video-downloader/video_downloader/rate_limit.py`
- Create: `video-downloader/tests/test_security.py`
- Create: `video-downloader/tests/test_rate_limit.py`

- [ ] **Step 1: 写签名凭证和所有权失败测试**

`test_security.py` 使用可控时钟，覆盖签名、篡改、过期和跨会话：

```python
import pytest

from video_downloader.errors import ServiceError
from video_downloader.security import ParseRecordStore, SessionService, TokenService


def test_parse_token_is_bound_to_session_and_expires(settings):
    now = [1000.0]
    clock = lambda: now[0]
    sessions = SessionService(settings.session_ttl_seconds, clock=clock)
    records = ParseRecordStore(settings.parse_token_ttl_seconds, clock=clock)
    tokens = TokenService(settings.signing_secret.get_secret_value(), settings.parse_token_ttl_seconds, clock=clock)

    session = sessions.create()
    record = records.put(session.digest, object())
    token = tokens.issue(record.id, session.digest)

    assert tokens.verify(token, session.digest).record_id == record.id
    with pytest.raises(ServiceError) as crossed:
        tokens.verify(token, sessions.create().digest)
    assert crossed.value.code == "JOB_NOT_FOUND"

    now[0] += settings.parse_token_ttl_seconds + 1
    with pytest.raises(ServiceError) as expired:
        tokens.verify(token, session.digest)
    assert expired.value.code == "JOB_EXPIRED"
```

再测 token 改一个字符必失败、Cookie 原值不进入 token payload、记录只保存于内存、过期清理删除内部 URL/格式映射。

- [ ] **Step 2: 写滑动窗口和客户端 IP 失败测试**

`test_rate_limit.py` 固定边界：第 10 次解析允许、第 11 次拒绝、窗口后恢复；第 3 次下载允许、第 4 次拒绝；不同 IP 独立。另测：直连地址不在 `trusted_proxies` 时忽略伪造 `X-Forwarded-For`；只有来自 `127.0.0.1`/`::1` 时读取第一个合法客户端 IP。

核心断言：

```python
with pytest.raises(ServiceError) as caught:
    limiter.consume("203.0.113.10", "parse")
assert caught.value.code == "RATE_LIMITED"
assert caught.value.http_status == 429
assert caught.value.retryable is True
```

- [ ] **Step 3: 运行测试并确认失败**

```powershell
cd E:\AI\gp\video-downloader
python -m pytest tests/test_security.py tests/test_rate_limit.py -q
```

Expected: FAIL，对应模块尚不存在。

- [ ] **Step 4: 实现安全状态服务**

`security.py` 的职责必须分开：

- `SessionService` 生成 32 字节 URL-safe 随机 Cookie，只在内存保存 SHA-256 摘要和过期时间。
- `TokenService` 使用 `itsdangerous.URLSafeSerializer` 签名 `{record_id, session_digest, expires_at}`；验证时使用注入时钟比较显式 `expires_at`，从而测试不依赖真实等待。
- `ParseRecordStore` 保存 `ExtractedVideo`、会话摘要、创建和过期时间；读取时同时验证记录存在、未过期和会话一致。
- 所有跨会话失败统一返回 `JOB_NOT_FOUND`，不泄露记录是否存在；凭证真正过期返回 `JOB_EXPIRED`。

`rate_limit.py` 使用 `collections.deque` 实现进程内滑动窗口，并用 `threading.Lock` 保护。`ClientIpResolver` 解析 `request.client.host` 和 `X-Forwarded-For`，只信任 `settings.trusted_proxies` 中的直接代理，非法头回退到直连地址。

- [ ] **Step 5: 运行安全测试**

```powershell
python -m pytest tests/test_security.py tests/test_rate_limit.py -q
```

Expected: 全部 PASS。

- [ ] **Step 6: 提交会话与限流**

```powershell
cd E:\AI\gp
git add -- video-downloader/video_downloader/security.py video-downloader/video_downloader/rate_limit.py video-downloader/tests/test_security.py video-downloader/tests/test_rate_limit.py
git commit -m "feat: bind video parsing to anonymous sessions"
```

## Task 5: 实现下载器、任务队列、取消与安全清理

**Files:**

- Create: `video-downloader/video_downloader/job_manager.py`
- Create: `video-downloader/video_downloader/files.py`
- Create: `video-downloader/tests/test_job_manager.py`
- Create: `video-downloader/tests/test_files.py`
- Modify: `video-downloader/video_downloader/extractor.py`
- Modify: `video-downloader/video_downloader/models.py`

- [ ] **Step 1: 写文件边界与清理失败测试**

`test_files.py` 覆盖路径和文件名攻击：

```python
from pathlib import Path

import pytest

from video_downloader.files import JobFiles, safe_download_name


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("普通标题", "普通标题-bilibili-BV1.mp4"),
        ("../CON:<测试>?", "CON_测试-bilibili-BV1.mp4"),
        ("   ", "video-bilibili-BV1.mp4"),
    ],
)
def test_safe_download_name(title, expected):
    assert safe_download_name(title, "bilibili", "BV1", "mp4") == expected


def test_cleanup_only_accepts_uuid_child_directory(tmp_path: Path):
    files = JobFiles(tmp_path / "jobs")
    files.ensure_root()
    outside = tmp_path / "outside"
    outside.mkdir()

    with pytest.raises(ValueError):
        files.cleanup(outside)
    assert outside.exists()
```

再测 Windows 保留名、控制字符、斜杠/反斜杠、超过 120 字符标题、合法 UUID 子目录可清理、启动清理只删除根目录下合法 UUID 目录且保留普通文件。

- [ ] **Step 2: 写任务状态机失败测试**

`test_job_manager.py` 使用异步 `FakeDownloader`，禁止启动真实 yt-dlp/FFmpeg：

```python
import asyncio
import threading

import pytest

from video_downloader.errors import ServiceError
from video_downloader.job_manager import JobManager, JobStatus


class FakeDownloader:
    def __init__(self):
        self.release = threading.Event()

    def download(self, job, hooks):
        hooks.extracting()
        hooks.downloading(downloaded_bytes=50, total_bytes=100, speed_bytes_per_second=10)
        assert self.release.wait(timeout=2)
        output = job.directory / "media.mp4"
        output.write_bytes(b"video")
        hooks.completed(output)
        return output


@pytest.mark.asyncio
async def test_job_moves_through_queue_and_completes(settings):
    downloader = FakeDownloader()
    manager = JobManager(settings, downloader)
    await manager.start()
    try:
        job = await manager.enqueue(
            session_digest="session-a",
            client_ip="203.0.113.10",
            parsed_video=object(),
            quality_id="q_demo",
        )
        for _ in range(20):
            if manager.get(job.id, "session-a").status is JobStatus.DOWNLOADING:
                break
            await asyncio.sleep(0.01)
        assert manager.get(job.id, "session-a").status in {
            JobStatus.EXTRACTING,
            JobStatus.DOWNLOADING,
        }
        downloader.release.set()
        await manager.wait(job.id)
        assert manager.get(job.id, "session-a").progress == 100
        assert manager.get(job.id, "session-a").status is JobStatus.COMPLETED
    finally:
        await manager.stop()
```

必须再写这些独立测试：

- 全局并发严格不超过 2；同一 IP 有一个排队或运行任务时第二个任务返回 `RATE_LIMITED`。
- 队列等待数达到 8 后返回 `QUEUE_FULL`。
- `queued` 取消立即变 `cancelled`；运行中取消设置线程安全事件；重复取消幂等。
- progress hook 将提取映射到 1–5、下载映射到 5–90、合并映射到 90–99、完成 100。
- 实际累计字节超过 2GB 时抛 `FILE_SIZE_LIMIT` 并清理全部片段。
- 下载异常和合并异常分别映射稳定错误并立即清理。
- 完成文件 TTL 后删除文件、状态改 `expired`，同会话读取返回 `JOB_EXPIRED`。
- 不同会话查询、取消和取文件都返回 `JOB_NOT_FOUND`。
- `stop()` 等待/取消 worker 和清理协程，不遗留 asyncio task。

- [ ] **Step 3: 运行任务测试并确认失败**

```powershell
cd E:\AI\gp\video-downloader
python -m pytest tests/test_files.py tests/test_job_manager.py -q
```

Expected: FAIL，文件管理器和任务管理器尚不存在。

- [ ] **Step 4: 实现文件管理与状态机**

`files.py`：

- `JobFiles.ensure_root()` 创建并解析安全根目录。
- `create_job_directory()` 只创建 `UUID4` 名称的直属子目录。
- `cleanup(path)` 在 `resolve()` 后再次确认 `path.parent == temp_root` 且名称可解析为 UUID，才允许 `shutil.rmtree`。
- `safe_download_name()` 移除控制字符、分隔符、Windows 保留名和尾随点/空格，标题最多 120 个 Unicode 字符；最终名固定为 `{title}-{platform}-{video_id}.{ext}`。

`job_manager.py` 定义以下稳定类型：

```python
class JobStatus(StrEnum):
    QUEUED = "queued"
    EXTRACTING = "extracting"
    DOWNLOADING = "downloading"
    MERGING = "merging"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


@dataclass
class DownloadJob:
    id: str
    session_digest: str
    client_ip: str
    parsed_video: ExtractedVideo
    quality_id: str
    directory: Path
    status: JobStatus = JobStatus.QUEUED
    progress: float = 0.0
    downloaded_bytes: int = 0
    total_bytes: int | None = None
    speed_bytes_per_second: float | None = None
    output_path: Path | None = None
    error: ApiErrorBody | None = None
    cancel_event: threading.Event = field(default_factory=threading.Event)
```

`JobManager.start()` 创建 `global_download_concurrency` 个 asyncio worker 和一个清理协程；`asyncio.Queue(maxsize=max_queue_size)` 只计等待任务。每个任务仍在单进程内，阻塞下载通过 `asyncio.to_thread` 执行。任务状态更新由锁保护，终态不会回退。

- [ ] **Step 5: 完成 yt-dlp 下载封装**

在 `extractor.py` 增加同步下载边界；`JobManager` 从内部 job 构造 `DownloadSpec`，生产下载器和测试替身都实现同一 `Downloader` Protocol：

```python
@dataclass(frozen=True)
class DownloadSpec:
    target: ResolvedVideoUrl
    video_id: str
    title: str
    selection: FormatSelection
    directory: Path
    cancel_event: threading.Event
```

`DownloadHooks` Protocol 精确定义 `extracting()`、`downloading(downloaded_bytes, total_bytes, speed_bytes_per_second)`、`merging()`、`completed(output_path)`；`Downloader` Protocol 定义 `download(spec: DownloadSpec, hooks: DownloadHooks) -> Path`。`JobManager` 使用 `await asyncio.to_thread(downloader.download, spec, hooks)`，因此测试替身和 yt-dlp 都不会阻塞事件循环。

在 `YtDlpExtractor.download` 实现：

- 只从服务端 `format_map[quality_id]` 取得 selector，客户端值不能进入 yt-dlp format 表达式。
- 输出模板固定为任务目录内 `media.%(ext)s`；不要把标题用于 yt-dlp 路径。
- 配置 `noplaylist=True`、同一 allowed extractor、`overwrites=False`、`continuedl=False`、`max_filesize=settings.max_file_bytes`、`progress_hooks` 和 `postprocessor_hooks`。
- 分离流设置 `merge_output_format`；需要合并但 FFmpeg 不可用时，在启动下载前返回 `DEPENDENCY_UNAVAILABLE`。
- progress hook 每次检查 `cancel_event` 和累计字节，取消时抛内部 `DownloadCancelled`，超限抛 `FILE_SIZE_LIMIT`。
- postprocessor hook 在开始时切到 `merging`，结束后保持 99%；不进行视频重编码。
- 找到最终文件后再次校验它是任务目录直属文件且不超过上限，再重命名为安全下载名。
- 将 yt-dlp postprocessing/FFmpeg 失败映射到 `MERGE_FAILED`，其他临时失败映射 `EXTRACTOR_TEMPORARILY_UNAVAILABLE`。

- [ ] **Step 6: 运行任务测试**

```powershell
python -m pytest tests/test_files.py tests/test_job_manager.py tests/test_extractor.py -q
```

Expected: 全部 PASS。

- [ ] **Step 7: 提交任务执行层**

```powershell
cd E:\AI\gp
git add -- video-downloader/video_downloader/job_manager.py video-downloader/video_downloader/files.py video-downloader/video_downloader/extractor.py video-downloader/video_downloader/models.py video-downloader/tests/test_job_manager.py video-downloader/tests/test_files.py
git commit -m "feat: run bounded video download jobs"
```

## Task 6: 组合完整 FastAPI 契约和授权边界

**Files:**

- Create: `video-downloader/tests/test_api.py`
- Modify: `video-downloader/video_downloader/app.py`
- Modify: `video-downloader/video_downloader/models.py`
- Modify: `video-downloader/tests/conftest.py`

- [ ] **Step 1: 写解析 API 失败测试**

`test_api.py` 通过 `create_app` 注入 Fake URL policy、Fake extractor、Fake downloader 和可控时钟。成功解析测试必须精确验证 Cookie 与响应：

```python
def test_parse_sets_private_session_and_returns_no_media_urls(client, fake_extractor):
    response = client.post("/api/v1/parse", json={"url": "https://b23.tv/demo"})

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"parseToken", "expiresAt", "video"}
    assert payload["video"]["platform"] == "bilibili"
    assert payload["video"]["qualities"][0]["id"].startswith("q_")
    assert "format_id" not in response.text
    assert "mediaUrl" not in response.text

    cookie = response.headers["set-cookie"]
    assert "sd_video_session=" in cookie
    assert "HttpOnly" in cookie
    assert "Secure" in cookie
    assert "SameSite=strict" in cookie
    assert "Path=/video-api/" in cookie
    assert "Max-Age=3600" in cookie
```

另测空链接、多个链接、URL 策略错误、解析限流、提取器错误，以及已有合法会话时不无故轮换 Cookie。

- [ ] **Step 2: 写任务 API 与文件授权失败测试**

覆盖以下请求链：

```text
POST /api/v1/parse                       -> 200 + parseToken
POST /api/v1/downloads                   -> 202 + queued
GET  /api/v1/downloads/{jobId}           -> 200 + progress fields
GET  /api/v1/downloads/{jobId}/file      -> 200 + safe attachment
DELETE /api/v1/downloads/{jobId}         -> 200 + cancelled (idempotent)
```

精确断言：篡改 `qualityId` 返回 400 `INVALID_URL`（消息为“清晰度选项无效，请重新解析”）；篡改/过期 parse token 返回 410 `JOB_EXPIRED`；不同 Cookie 查询同一 job 返回 404 `JOB_NOT_FOUND`；未完成文件返回 404 `JOB_NOT_FOUND`；完成文件响应包含 `Content-Disposition: attachment`、`X-Content-Type-Options: nosniff`、`Cache-Control: private, no-store`。

- [ ] **Step 3: 运行 API 测试并确认失败**

```powershell
cd E:\AI\gp\video-downloader
python -m pytest tests/test_api.py -q
```

Expected: FAIL，路由尚未组合。

- [ ] **Step 4: 实现 lifespan、依赖组合与路由**

`create_app` 最终签名允许测试注入但生产调用无需参数：

```python
def create_app(
    settings: VideoSettings | None = None,
    dependency_probe: DependencyProbe | None = None,
    url_policy: UrlPolicy | None = None,
    extractor: YtDlpExtractor | None = None,
    rate_limiter: SlidingWindowRateLimiter | None = None,
    session_service: SessionService | None = None,
    parse_store: ParseRecordStore | None = None,
    token_service: TokenService | None = None,
    job_manager: JobManager | None = None,
) -> FastAPI:
```

lifespan 顺序固定为：校验/创建 temp root → 清理上次进程 UUID 目录 → 启动任务 workers/清理循环 → 提供服务；关闭时停止接单、取消 workers、清理未完成目录。

请求模型和响应模型必须覆盖设计文档字段：

```python
class ParseRequest(ApiModel):
    url: str = Field(min_length=1, max_length=4096)


class ParseResponse(ApiModel):
    parse_token: str
    expires_at: datetime
    video: VideoInfo


class CreateDownloadRequest(ApiModel):
    parse_token: str = Field(min_length=16, max_length=4096)
    quality_id: str = Field(pattern=r"^q_[a-zA-Z0-9_-]{8,32}$")


class CreateDownloadResponse(ApiModel):
    job_id: str
    status: Literal["queued"]
```

状态响应包含 `jobId`、`status`、`stage`、`progress`、`downloadedBytes`、`totalBytes`、`speedBytesPerSecond`、`error`；未知值输出 `null`，不能省略导致前端分支不稳定。

每条路由先经 `ClientIpResolver` 和会话所有权检查。`POST /parse` 消耗解析额度；`POST /downloads` 消耗下载额度并检查依赖、解析凭证、质量 ID、大小和并发。`GET/DELETE/file` 不消耗创建额度，但仍校验所有权。

Cookie 设置参数固定为：`httponly=True`、`secure=settings.cookie_secure`、`samesite="strict"`、`path=settings.cookie_path`、`max_age=settings.session_ttl_seconds`。应用日志不得打印请求 body、Cookie、token 或完整 URL。

为 `RequestValidationError` 增加异常处理器，将请求体字段错误统一返回 HTTP 400 `INVALID_URL`，不要让 FastAPI 默认 422 数组结构绕过稳定错误 envelope。响应统一设置 `Cache-Control: no-store`；文件接口覆盖为 `private, no-store`。

文件末尾必须暴露 Uvicorn 入口 `app = create_app()`；生产和本地清单都引用 `video_downloader.app:app`。

- [ ] **Step 5: 运行完整后端测试**

```powershell
cd E:\AI\gp\video-downloader
python -m pytest -q -m "not live"
```

Expected: 全部 PASS，且没有网络访问。

- [ ] **Step 6: 提交 API 契约**

```powershell
cd E:\AI\gp
git add -- video-downloader/video_downloader/app.py video-downloader/video_downloader/models.py video-downloader/tests/conftest.py video-downloader/tests/test_api.py
git commit -m "feat: expose secure video download API"
```

## Task 7: 创建前端类型、API 客户端和可测试状态逻辑

**Files:**

- Modify: `SD/package.json`
- Modify: `SD/package-lock.json`
- Create: `SD/components/tools/video/types.ts`
- Create: `SD/components/tools/video/api.ts`
- Create: `SD/components/tools/video/state.ts`
- Create: `SD/components/tools/video/api.test.ts`
- Create: `SD/components/tools/video/state.test.ts`

- [ ] **Step 1: 安装固定的交互测试依赖**

```powershell
cd E:\AI\gp\SD
npm.cmd install --save-dev --save-exact @testing-library/react@16.3.2 @testing-library/user-event@14.6.6 jsdom@30.0.1
```

Expected: `package.json` 和 `package-lock.json` 只增加上述三个 devDependencies，不升级无关依赖。

- [ ] **Step 2: 写 API 客户端失败测试**

`api.test.ts` 用 `vi.stubGlobal('fetch', vi.fn())`，至少包含：

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDownload, parseVideo } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('video downloader API client', () => {
  it('uses the same-origin private API without exposing direct media URLs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      parseToken: 'signed-token',
      expiresAt: '2026-08-24T00:00:00Z',
      video: {
        platform: 'bilibili', id: 'BV1', title: '标题', author: '作者',
        thumbnailUrl: null, durationSeconds: 10,
        qualities: [{ id: 'q_12345678', label: '720P', height: 720, extension: 'mp4', estimatedBytes: null, requiresMerge: false, hasAudio: true }],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await parseVideo('https://b23.tv/demo');

    expect(fetchMock).toHaveBeenCalledWith('/video-api/api/v1/parse', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
    }));
  });

  it('raises a typed error from the stable backend envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'RATE_LIMITED', message: '请求过于频繁', retryable: true },
    }), { status: 429, headers: { 'Content-Type': 'application/json' } })));

    await expect(createDownload('token', 'q_12345678')).rejects.toMatchObject({
      code: 'RATE_LIMITED', retryable: true, status: 429,
    });
  });
});
```

再测 `getHealth`、`getDownload`、`cancelDownload` 的 method/path，`downloadFileUrl` 只接受符合 job ID 正则的值，非 JSON/网络失败统一成 `DEPENDENCY_UNAVAILABLE`。

- [ ] **Step 3: 写纯状态逻辑失败测试**

`state.test.ts` 覆盖平台提示、阶段文案、格式化和 reducer：

```typescript
expect(detectPlatform('复制 https://v.douyin.com/abc')).toBe('douyin');
expect(detectPlatform('https://www.bilibili.com/video/BV1')).toBe('bilibili');
expect(formatBytes(null)).toBe('大小未知');
expect(stageLabel('merging')).toBe('正在合并音视频');
expect(errorMessage({ code: 'COOKIE_REQUIRED', message: '', retryable: true })).toContain('服务器解析凭据');
```

reducer 必须覆盖 `parseStarted`、`parseSucceeded`、`parseFailed`、`jobCreated`、`jobUpdated`、`jobFailed`、`reset`；解析错误清空旧 token，任务错误保留已解析视频以便重试。

- [ ] **Step 4: 运行测试并确认失败**

```powershell
cd E:\AI\gp\SD
npm.cmd test -- components/tools/video/api.test.ts components/tools/video/state.test.ts
```

Expected: FAIL，模块尚不存在。

- [ ] **Step 5: 实现严格前端契约**

`types.ts` 必须声明后端全部公开类型，不加入 raw URL/format ID：

```typescript
export type Platform = 'douyin' | 'bilibili';
export type JobStage = 'queued' | 'extracting' | 'downloading' | 'merging' | 'completed' | 'failed' | 'cancelled' | 'expired';

export interface QualityOption {
  id: string;
  label: string;
  height: number;
  extension: string;
  estimatedBytes: number | null;
  requiresMerge: boolean;
  hasAudio: boolean;
}

export interface ParsedVideo {
  platform: Platform;
  id: string;
  title: string;
  author: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number;
  qualities: QualityOption[];
}
```

`api.ts` 固定 `API_BASE='/video-api/api/v1'` 和 `credentials:'same-origin'`。所有 JSON 请求设置 `Accept: application/json`、写请求设置 `Content-Type: application/json`，并使用 `cache:'no-store'`。不得将 token 放入 query string；文件 URL 只含 job ID。

`state.ts` 导出纯 reducer、格式化器、平台检测和稳定中文错误映射。后端 `message` 可作为补充，但已知错误优先使用本站文案；未知错误显示通用提示，不直接渲染堆栈或 HTML。

- [ ] **Step 6: 运行前端逻辑测试**

```powershell
npm.cmd test -- components/tools/video/api.test.ts components/tools/video/state.test.ts
npm.cmd run lint
```

Expected: 两组测试 PASS，TypeScript 无错误。

- [ ] **Step 7: 提交前端契约层**

```powershell
cd E:\AI\gp
git add -- SD/package.json SD/package-lock.json SD/components/tools/video/types.ts SD/components/tools/video/api.ts SD/components/tools/video/state.ts SD/components/tools/video/api.test.ts SD/components/tools/video/state.test.ts
git commit -m "feat: add video downloader client state"
```

## Task 8: 实现参考图风格的响应式视频解析页面

**Files:**

- Create: `SD/components/tools/video/VideoDownloader.tsx`
- Create: `SD/components/tools/video/VideoDownloader.test.tsx`

- [ ] **Step 1: 写初始页面和无障碍失败测试**

文件顶部使用 `// @vitest-environment jsdom`。初始测试精确检查标题、真实 label、四个特性卡、三步说明和合规文案：

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VideoDownloader from './VideoDownloader';

vi.mock('./api', () => ({
  getHealth: vi.fn().mockResolvedValue({ status: 'ok', capabilities: { ytDlp: true, ffmpeg: true, douyinCookie: 'configured' } }),
  parseVideo: vi.fn(),
  createDownload: vi.fn(),
  getDownload: vi.fn(),
  cancelDownload: vi.fn(),
  downloadFileUrl: (jobId: string) => `/video-api/api/v1/downloads/${jobId}/file`,
}));

describe('VideoDownloader', () => {
  it('renders the approved initial hierarchy and compliance boundary', () => {
    render(<VideoDownloader onClose={() => undefined} />);

    expect(screen.getByRole('heading', { name: '视频解析下载' })).toBeTruthy();
    expect(screen.getByLabelText('抖音或 B 站视频链接')).toBeTruthy();
    expect(screen.getByRole('button', { name: '粘贴' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '解析视频' })).toBeTruthy();
    expect(screen.getByText('无需登录')).toBeTruthy();
    expect(screen.getByText('实际清晰度')).toBeTruthy();
    expect(screen.getByText('临时处理')).toBeTruthy();
    expect(screen.getByText('快速下载')).toBeTruthy();
    expect(screen.getByText(/仅下载你拥有权利或已获授权的公开视频/)).toBeTruthy();
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  });
});
```

- [ ] **Step 2: 写解析、下载、取消和剪贴板交互失败测试**

使用 `userEvent.setup()` 和 API mock，覆盖：

1. 空输入不调用 API，并显示输入错误。
2. Enter 提交；解析期间按钮 disabled，成功后显示标题、作者、时长、封面、清晰度、未知大小和“需要合并音视频”。
3. 健康状态 `ytDlp=false` 时禁用解析；`ffmpeg=false` 时只禁用 `requiresMerge=true` 的质量。
4. 创建任务后每秒轮询，依次显示等待/提取/下载/合并/完成；完成链接指向本站 file endpoint。
5. 点击取消调用 DELETE，页面显示已取消且保留解析结果。
6. 组件卸载时取消 AbortController/timeout，之后不再轮询。
7. Clipboard 成功填入文本；权限拒绝时聚焦输入并显示“请手动粘贴”，不清空已有输入。
8. 图片使用 `referrerPolicy="no-referrer"`、安全 alt 和失败后的平台占位图。

轮询测试使用 `vi.useFakeTimers()`，每次推进 1000ms，测试结束恢复真实计时器；不能真实等待。

- [ ] **Step 3: 运行组件测试并确认失败**

```powershell
cd E:\AI\gp\SD
npm.cmd test -- components/tools/video/VideoDownloader.test.tsx
```

Expected: FAIL，组件尚不存在。

- [ ] **Step 4: 实现页面状态和视觉层级**

组件只依赖 `api.ts` 和 `state.ts`，保持以下结构：

```text
暖色玻璃容器
  标题 + 副标题 + 支持平台/隐私标签
  label + 链接输入 + 粘贴 + 解析视频
  aria-live 状态/错误
  ├─ 初始：四个特性卡 + 三步说明
  └─ 成功：封面与元数据 + 清晰度列表
       └─ 当前任务进度、速度、字节、取消/保存
  固定版权与平台条款提示
```

视觉实现使用现有 Tailwind，不添加全局 CSS：暖白背景、橙/玫瑰渐变、半透明边框和轻阴影；不得照抄参考站黑白样式。桌面 `lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]`，移动端单列。输入/按钮最小高度 `min-h-11`，内容使用 `break-words`/`min-w-0` 防溢出，动画同时带 `motion-reduce:transition-none`。

解析成功后隐藏大面积初始说明。质量按钮文案必须包含真实档位和格式，未知大小显示“大小未知”；无音频明确显示“该源不含音频”。前端不得出现“保证无水印”或“保证 1080P”。

下载完成使用真实 `<a download href={downloadFileUrl(jobId)}>`，不要先 fetch Blob；浏览器会自动带同源 HttpOnly Cookie。轮询用可取消的 `setTimeout` 链而不是叠加 `setInterval`，网络错误可保留一次重试状态。

- [ ] **Step 5: 运行组件和契约测试**

```powershell
npm.cmd test -- components/tools/video
npm.cmd run lint
```

Expected: PASS；无 act warning、未处理 Promise 或定时器泄漏。

- [ ] **Step 6: 提交页面组件**

```powershell
cd E:\AI\gp
git add -- SD/components/tools/video/VideoDownloader.tsx SD/components/tools/video/VideoDownloader.test.tsx
git commit -m "feat: build video parser downloader UI"
```

## Task 9: 注册视频分类、SEO、FAQ 和 sitemap

**Files:**

- Modify: `SD/tools/registry.tsx`
- Modify: `SD/tools/registryMetadata.test.ts`
- Modify: `SD/components/ToolWindow.tsx`（已有用户修改，保留并不整文件暂存）
- Modify: `SD/public/sitemap.xml`（已有用户修改，保留并不整文件暂存）
- Modify: `SD/README.md`

- [ ] **Step 1: 先扩展注册表测试并确认失败**

在 `registryMetadata.test.ts` 把总数从 185 更新为 186，并新增精确断言：

```typescript
it('registers the public video downloader with an explicit remote privacy boundary', () => {
  const tool = TOOLS.find((item) => item.id === 'video-parser-downloader');
  expect(tool).toMatchObject({
    name: '视频解析下载',
    category: 'video',
    icon: 'Video',
    privacy: 'third-party-api',
    status: 'beta',
  });
  expect(CATEGORIES.some((category) => category.id === 'video')).toBe(true);
});
```

Run:

```powershell
cd E:\AI\gp\SD
npm.cmd test -- tools/registryMetadata.test.ts
```

Expected: FAIL，工具和分类未注册。

- [ ] **Step 2: 注册 lazy component、工具和分类**

在 `ToolDef.category` union 增加 `'video'`，新增 lazy import，并加入：

```tsx
{
  id: 'video-parser-downloader',
  name: '视频解析下载',
  description: '解析并下载抖音与B站单个公开视频，展示平台实际可用清晰度和任务进度',
  icon: 'Video',
  category: 'video',
  color: 'pink',
  gradient: 'from-orange-500 to-rose-500',
  glow: 'rgba(244,63,94,0.3)',
  component: VideoDownloader,
  privacy: 'third-party-api',
  status: 'beta',
  tags: ['shipin', '视频', 'xiazai', '下载', 'jiexi', '解析', 'douyin', '抖音', 'bilibili', 'B站', '哔哩哔哩', '无水印'],
}
```

分类定义：

```tsx
{ id: 'video', name: '视频工具', description: '公开视频解析与临时下载', icon: 'Video', color: 'pink', gradient: 'from-orange-500 to-rose-500' }
```

`Video` 已存在于 `SD/lib/iconMap.ts`，不要重复改 icon map。

- [ ] **Step 3: 添加工具窗口说明和 FAQ**

开始前运行：

```powershell
git diff -- SD/components/ToolWindow.tsx
```

只向现有 `TOOL_USAGE`、`TOOL_FAQ` 对象增加：

```tsx
'video-parser-downloader': {
  steps: ['复制抖音或 B 站单个公开视频链接', '粘贴链接并点击“解析视频”', '选择实际可用清晰度并等待处理', '完成后点击“保存视频”'],
  tips: ['仅支持无需登录的单个公开视频', 'B 站高清源可能需要服务器合并音视频', '解析凭证和完成文件都会自动过期'],
}
```

FAQ 必须明确：不保证去除画面已有水印；不支持合集/多 P/会员内容；链接会发送到本站后端并由后端访问平台。

- [ ] **Step 4: 更新 sitemap 和主站 README**

开始前运行：

```powershell
git diff -- SD/public/sitemap.xml
```

在现有 sitemap 中只追加一次：

```xml
<url><loc>https://zhumenggy.top/tool/video-parser-downloader</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>
```

`SD/README.md` 更新为 **186 个工具、17 个分类**，分类表新增“视频工具 | 1”，再增加简短“视频解析下载”章节，说明服务端口 8011、FFmpeg、单公开视频范围和隐私边界。

- [ ] **Step 5: 运行注册、SEO 和 sitemap 契约**

```powershell
cd E:\AI\gp\SD
npm.cmd run validate
npm.cmd test -- tools/registryMetadata.test.ts lib/toolSeo.test.ts tools/sitemap.test.ts
npm.cmd run lint
```

Expected: 全部 PASS；sitemap 中 186 个工具 ID 各出现一次，SEO 描述均为 120–160 字符。

- [ ] **Step 6: 提交可安全独立暂存的注册改动**

`ToolWindow.tsx` 和 `sitemap.xml` 当前含用户改动，本步骤不整文件暂存。先提交干净基线文件：

```powershell
cd E:\AI\gp
git add -- SD/tools/registry.tsx SD/tools/registryMetadata.test.ts SD/README.md
git commit -m "feat: register video download tool"
```

然后保留 `ToolWindow.tsx`、`sitemap.xml` 的功能修改在工作树；交付前通过 `git diff --` 单独展示。若执行时确认这些文件的既有修改已经属于同一功能且用户允许提交，才可逐 hunk 暂存，不能默认整文件提交。

## Task 10: 接入 Vite、Nginx、环境变量、宝塔和本地服务编排

**Files:**

- Modify: `SD/vite.config.ts`
- Modify: `scripts/local-services.json`
- Modify: `scripts/tests/local-services.tests.ps1`
- Modify: `scripts/check-local.ps1`
- Modify: `.env.local.example`
- Modify: `.env.production.example`（已有用户修改，保留并不整文件暂存）
- Modify: `nginx.conf`（已有用户修改，保留并不整文件暂存）
- Modify: `deploy/nginx/site-modules.conf.example`
- Modify: `deploy/baota/README.md`
- Modify: `README.md`
- Create: `video-downloader/README.md`
- Create: `video-downloader/tests/test_live_smoke.py`

- [ ] **Step 1: 先写本地服务清单失败测试**

在 `local-services.tests.ps1` 新增：

```powershell
It 'runs the in-memory video service as one worker on 8011' {
    $manifest = Get-LocalServiceManifest -Path (Join-Path (Join-Path $PSScriptRoot '..') 'local-services.json')
    $video = @($manifest.services | Where-Object { $_.name -eq 'video-downloader' })
    $video.Count | Should Be 1
    @($video[0].ports) | Should Contain 8011
    [string]$video[0].health_url | Should Be 'http://127.0.0.1:8011/health'
    ($video[0].arguments -join ' ') | Should Match '--workers 1'
}
```

Run:

```powershell
cd E:\AI\gp
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Pester -Path '.\scripts\tests\local-services.tests.ps1'"
```

Expected: FAIL，清单还没有该服务。

- [ ] **Step 2: 接入开发代理和本地进程**

`SD/vite.config.ts` 在 `/api` 通配代理之前增加：

```typescript
'/video-api': {
  target: 'http://127.0.0.1:8011',
  changeOrigin: true,
  rewrite: (path: string) => path.replace(/^\/video-api/, ''),
  timeout: 900000,
},
```

`scripts/local-services.json` 在 document-converter 后加入：

```json
{"name":"video-downloader","working_directory":"video-downloader","executable":"python","arguments":["-m","uvicorn","video_downloader.app:app","--host","127.0.0.1","--port","8011","--workers","1"],"ports":[8011],"health_url":"http://127.0.0.1:8011/health"}
```

`check-local.ps1` 增加 `/health` 检查，并断言 JSON 的 `capabilities.ytDlp`、`capabilities.ffmpeg` 字段存在；依赖缺失时健康接口仍是 HTTP 200，所以不要强制 `status=ok`。在通用 HTTP 检查之后加入：

```powershell
try {
    $videoHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8011/health' -Method GET -TimeoutSec 5
    $hasCapabilities = $null -ne $videoHealth.capabilities `
        -and $null -ne $videoHealth.capabilities.PSObject.Properties['ytDlp'] `
        -and $null -ne $videoHealth.capabilities.PSObject.Properties['ffmpeg']
    Report 'video downloader capabilities' $hasCapabilities
} catch {
    Report 'video downloader capabilities' $false $_.Exception.Message
}
```

- [ ] **Step 3: 添加非敏感环境变量示例**

`.env.local.example` 加入：

```dotenv
VIDEO_ENVIRONMENT=development
VIDEO_SIGNING_SECRET=
VIDEO_TEMP_DIR=.runtime/video-downloads
VIDEO_COOKIE_SECURE=false
VIDEO_TRUSTED_PROXIES=127.0.0.1/32,::1/128
VIDEO_DOUYIN_COOKIE_FILE=
VIDEO_FFMPEG_BIN=ffmpeg
VIDEO_LIVE_DOUYIN_URL=
VIDEO_LIVE_BILIBILI_URL=
```

`.env.production.example` 使用 `VIDEO_ENVIRONMENT=production`、`VIDEO_COOKIE_SECURE=true`、服务器绝对临时目录 `/www/wwwroot/110.40.174.239/runtime/video-downloads`，签名密钥和 Cookie 路径留空。不要写真实值。其余资源限制只在示例中以注释列出默认值，避免复制出互相冲突的配置。

- [ ] **Step 4: 合并隐私安全的 Nginx 路由**

修改前分别检查已有差异：

```powershell
git diff -- nginx.conf .env.production.example
```

在 `nginx.conf` 和 `deploy/nginx/site-modules.conf.example` 加入：

```nginx
location ^~ /video-api/ {
    proxy_pass http://127.0.0.1:8011/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_cache off;
    client_max_body_size 16k;
    proxy_connect_timeout 10s;
    proxy_read_timeout 900s;
    proxy_send_timeout 900s;
    add_header Cache-Control "private, no-store" always;
    access_log off;
}
```

这里使用 `access_log off` 是因为当前文件是宝塔生成的 `server {}` 片段，不能合法声明 http 级 `log_format`；它比默认包含 `$request` 查询串的 combined 日志更严格地满足“不记录 token/query/Cookie”。安全审计字段由应用结构化日志提供。

- [ ] **Step 5: 写部署和服务 README**

`video-downloader/README.md` 必须包含：支持/不支持范围、Python 安装、FFmpeg 检查、单 worker 启动、全部 `VIDEO_*` 设置、Cookie 文件最小权限、API 表、错误码、临时目录清理、测试和可选 live smoke 命令。

`deploy/baota/README.md` 增加 8011 端口、进程表和独立章节：

```bash
<PYTHON> -m pip install -e "<SITE_ROOT>/video-downloader"
cd <SITE_ROOT>/video-downloader
<PYTHON> -m uvicorn video_downloader.app:app --host 127.0.0.1 --port 8011 --workers 1
```

说明先运行 `ffmpeg -version`、为临时目录授予服务账号读写权限、Cookie 文件仅服务账号可读、更新 yt-dlp 固定版本后必须回归测试。上线验收增加健康、匿名解析、任务下载、跨会话 404、过期文件 410 和 Nginx 不缓存。

根 `README.md`：核心模块表增加视频解析服务；快速安装增加 `python -m pip install -e ".\video-downloader[dev]"`；本地启动改为 11 个后端/设备进程 + 3 个前端、15 个监听端口；端口表增加 8011；检查范围改为 8000–8011。

- [ ] **Step 6: 添加显式 opt-in 的真实冒烟测试**

`test_live_smoke.py` 只在环境变量存在时运行：

```python
import os

import pytest

from video_downloader.config import VideoSettings
from video_downloader.extractor import YtDlpExtractor
from video_downloader.url_policy import UrlPolicy


@pytest.mark.live
@pytest.mark.parametrize(
    ("env_name", "platform"),
    [("VIDEO_LIVE_DOUYIN_URL", "douyin"), ("VIDEO_LIVE_BILIBILI_URL", "bilibili")],
)
def test_authorized_public_video_can_be_parsed(env_name, platform):
    url = os.getenv(env_name)
    if not url:
        pytest.skip(f"{env_name} is not configured")
    settings = VideoSettings()
    target = UrlPolicy.from_settings(settings).resolve(url)
    result = YtDlpExtractor(settings).extract(target)
    assert result.video.platform == platform
    assert result.video.qualities
```

默认 `pytest -m "not live"` 不运行它；README 明确要求 URL 指向部署者拥有或获授权的公开视频。第一版 live test 只解析元数据，不自动下载第三方内容。

- [ ] **Step 7: 运行编排和配置测试**

```powershell
cd E:\AI\gp
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Pester -Path '.\scripts\tests\local-services.tests.ps1'"

cd E:\AI\gp\video-downloader
python -m pytest -q -m "not live"

cd E:\AI\gp\SD
npm.cmd run lint
```

Expected: 全部 PASS；live tests 显式排除。

- [ ] **Step 8: 提交干净的部署文件并保留共享脏文件**

```powershell
cd E:\AI\gp
git add -- SD/vite.config.ts scripts/local-services.json scripts/tests/local-services.tests.ps1 scripts/check-local.ps1 .env.local.example deploy/nginx/site-modules.conf.example deploy/baota/README.md README.md video-downloader/README.md video-downloader/tests/test_live_smoke.py
git commit -m "chore: wire video downloader deployment"
```

`.env.production.example` 和 `nginx.conf` 不整文件暂存；与 Task 9 的 `ToolWindow.tsx`、`sitemap.xml` 一起保留并在最终差异审计中列出。

## Task 11: 全量验证、人工冒烟与交付审计

**Files:**

- Modify only if a test exposes a defect; use the owning task's files.
- Review: all files from Tasks 1–10.

- [ ] **Step 1: 运行后端完整离线测试**

```powershell
cd E:\AI\gp\video-downloader
python -m pytest -q -m "not live"
```

Expected: 全部 PASS，无网络访问、无未清理临时目录、无 pending asyncio task warning。

- [ ] **Step 2: 运行 SD 全部质量门**

```powershell
cd E:\AI\gp\SD
npm.cmd run validate
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected: 四条命令 exit code 0；注册表 186 个工具、17 个分类；生产构建生成视频工具 lazy chunk。

- [ ] **Step 3: 运行仓库编排测试和差异检查**

```powershell
cd E:\AI\gp
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Pester -Path '.\scripts\tests\local-services.tests.ps1'"
git diff --check
git status --short
git diff -- video-downloader SD/components/tools/video SD/tools/registry.tsx SD/components/ToolWindow.tsx SD/public/sitemap.xml SD/vite.config.ts nginx.conf deploy/nginx/site-modules.conf.example deploy/baota/README.md scripts/local-services.json scripts/check-local.ps1 .env.local.example .env.production.example README.md SD/README.md
```

Expected: 测试通过、`git diff --check` 无空白错误；差异中没有真实 Cookie/密钥/媒体 URL；无关用户文件保持原样。

- [ ] **Step 4: 启动本地服务做浏览器冒烟**

准备本地 `.env.local`，确保 `VIDEO_COOKIE_SECURE=false`，然后：

```powershell
cd E:\AI\gp
.\scripts\start-local.ps1
.\scripts\check-local.ps1
```

打开 `http://127.0.0.1:5173/tool/video-parser-downloader`，使用部署者有权测试的单个公开视频检查：

- 空输入、粘贴失败和不支持域名提示正确。
- 抖音与 B 站至少各解析一个单公开视频；不显示原始媒体直链。
- B 站分离流进入 merging，最终文件有音视频；抖音单流可跳过 merging。
- 取消会清理任务；完成文件可以保存；跨浏览器无权读取任务。
- 移动宽度 375px 无横向滚动，键盘 Enter/Tab 可完成操作，状态由 aria-live 宣告。

如果没有授权测试链接，只完成自动化和页面空态冒烟，不临时使用未知第三方作品。

- [ ] **Step 5: 生产配置静态验收**

在服务器或等价 Nginx 环境执行：

```bash
nginx -t
ffmpeg -version
curl -fsS http://127.0.0.1:8011/health
```

Expected: Nginx 配置通过；FFmpeg 可用；健康响应只含 `status` 和三个公开 capability，不含任何路径、Cookie 内容或密钥。

- [ ] **Step 6: 自审设计覆盖与实现一致性**

逐项确认：

- API 字段 camelCase 与前端类型完全一致，`null`/可选字段没有漂移。
- 全部 15 个稳定错误码有后端映射和前端展示策略。
- URL allowlist、重定向上限、DNS/IP 筛查、凭证 TTL、Cookie 属性、限流、并发、大小、时长、清理和跨会话测试均存在。
- 代码中没有 `TODO`、`pass`、伪成功、硬编码 live URL、硬编码平台 Cookie 或把 raw media URL 返回前端。
- Uvicorn 所有启动文档和清单均为 `--workers 1`。
- 页面不承诺无水印、固定 1080P、会员/登录内容或平台权限绕过。

Run:

```powershell
cd E:\AI\gp
rg -n "TODO|FIXME|pass$|mediaUrl|format_id|VIDEO_SIGNING_SECRET=.+|VIDEO_DOUYIN_COOKIE_FILE=.+" video-downloader SD/components/tools/video .env.local.example .env.production.example
```

Expected: `mediaUrl`、`format_id` 只出现在用于证明“不泄露”的测试断言中，环境示例敏感值为空，不存在待完成占位。

- [ ] **Step 7: 处理共享脏文件的最终交付**

不要自动提交用户既有修改。最终说明以下四个文件包含本功能变更但仍混有先前工作树内容：

```text
SD/components/ToolWindow.tsx
SD/public/sitemap.xml
.env.production.example
nginx.conf
```

如果执行阶段已能通过基线快照精确分离本功能 hunk，可只提交这些 hunk：

```powershell
git commit -m "chore: publish video downloader routes"
```

否则保持未暂存并给出逐文件差异摘要。绝不为了得到“干净工作树”而 reset、checkout 或覆盖这些文件。

## 完成定义

只有同时满足以下条件才可宣告完成：离线后端测试、SD validate/test/lint/build、编排测试全部通过；页面可在本地打开；API 不泄露媒体直链或凭证；文件/任务绑定会话；共享脏文件被保留；部署文档明确单 worker、FFmpeg、Cookie 权限和版权边界。真实平台冒烟因无授权 URL 被跳过时，要在交付中明确写“未执行”，不能写成已通过。
