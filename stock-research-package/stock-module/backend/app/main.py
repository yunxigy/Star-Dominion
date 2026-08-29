"""FastAPI entry point for the Star Dominion stock hub."""

from contextlib import asynccontextmanager
from datetime import date

import os
import secrets

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status

from app.config import Settings
from app.domain.analysis_tasks import (
    AnalysisCreate,
    AnalysisReportPublic,
    AnalysisTaskPublic,
)
from app.domain.model_profiles import (
    ModelCatalogResponse,
    ModelConnectionTestRequest,
    ModelConnectionTestResponse,
    ModelProfileCreate,
    ModelProfilePublic,
    ModelProfileUpdate,
)
from app.domain.morning_reports import (
    MorningReport,
    MorningReportHistoryResponse,
    StockResearchContext,
)
from app.domain.market_data import KlineUnavailable, StockKline
from app.domain.mom_index import MomIndexHistoryResponse, MomIndexSnapshot
from app.domain.stocks import InvalidMainBoardSymbol
from app.integrations.candidate_sources import (
    CatalystReportSource,
    SmallCapAbsorptionSnapshotSource,
    UserStrategySnapshotSource,
)
from app.integrations.catalyst_reports import CatalystMorningReportAdapter
from app.integrations.candidate_workers import SubprocessCandidateWorker
from app.integrations.individual_analysis import IndividualAnalysisClient
from app.integrations.mom_sources import EastmoneyMomSource, XiaohongshuMomSource
from app.integrations.market_data import SinaKlineSource
from app.integrations.model_providers import ModelProviderError, OpenAICompatibleProviderClient
from app.integrations.stock_directory_sources import AkshareStockDirectorySource
from app.integrations.xhs_mcp import XhsMcpClient
from app.repositories.analysis_tasks import AnalysisTaskRepository
from app.repositories.candidate_snapshots import CandidateSnapshotRepository
from app.repositories.morning_reports import MorningReportRepository
from app.repositories.refresh_tasks import RefreshTaskRepository
from app.repositories.model_profiles import ModelProfileRepository
from app.repositories.job_leases import JobLeaseRepository
from app.repositories.kline_cache import KlineRepository
from app.repositories.mom_index import MomIndexRepository
from app.repositories.stock_directory import StockDirectoryRepository
from app.security.network_policy import UnsafeModelEndpoint
from app.security.route_tokens import RouteTokenIssuer
from app.security.secrets import FernetSecretStore, SecretNotFound
from app.security.site_auth import SiteAuthClient, SiteAuthRejected, SiteIdentity
from app.services.analysis_coordinator import AnalysisCoordinator
from app.services.candidate_refresh import CandidateRefreshService
from app.services.refresh_coordinator import CandidateRefreshCoordinator
from app.services.model_profiles import ModelProfileNotFound, ModelProfileService
from app.services.morning_reports import MorningReportService, MorningReportUnavailable
from app.services.kline import KlineService
from app.services.mom_index import MomIndexService
from app.services.scheduled_jobs import BackgroundOperationCoordinator, build_scheduler
from app.services.stock_directory import StockDirectory
from app.services.stock_directory_refresh import StockDirectoryRefreshService
from app.services.xhs_login import XhsLoginService


def create_app(
    *,
    settings: Settings | None = None,
    candidate_service: CandidateRefreshService | None = None,
    refresh_coordinator: CandidateRefreshCoordinator | None = None,
    morning_report_service: MorningReportService | None = None,
    model_profile_service: ModelProfileService | None = None,
    analysis_coordinator: AnalysisCoordinator | None = None,
    site_auth_client: SiteAuthClient | None = None,
    stock_directory=None,
    stock_directory_refresh_service=None,
    kline_service=None,
    mom_index_service=None,
    mom_refresh_coordinator=None,
    xhs_login_service=None,
    scheduler=None,
) -> FastAPI:
    configured = settings or Settings.from_env()
    database_path = configured.data_dir / "hub.db"
    stock_repository = StockDirectoryRepository(database_path)
    directory = stock_directory or StockDirectory(stock_repository)
    directory_refresher = stock_directory_refresh_service or StockDirectoryRefreshService(
        stock_repository,
        AkshareStockDirectorySource(),
    )
    klines = kline_service or KlineService(
        KlineRepository(database_path),
        SinaKlineSource(),
        directory=directory,
    )
    leases = JobLeaseRepository(database_path)

    xhs_client = XhsMcpClient(
        list(configured.xhs_mcp_command),
        data_dir=configured.xhs_data_dir or configured.data_dir / "xhs-mcp",
    )
    mom_indexes = mom_index_service or MomIndexService(
        MomIndexRepository(database_path),
        eastmoney=EastmoneyMomSource(proxy=configured.market_proxy),
        xiaohongshu=XiaohongshuMomSource(xhs_client),
    )
    mom_refreshes = mom_refresh_coordinator or BackgroundOperationCoordinator(
        job_name="mom-index-refresh",
        operation=mom_indexes.refresh,
        leases=leases,
    )
    directory_refreshes = BackgroundOperationCoordinator(
        job_name="stock-directory-refresh",
        operation=directory_refresher.refresh,
        leases=leases,
    )
    xhs_logins = xhs_login_service or XhsLoginService(xhs_client)
    service = candidate_service or CandidateRefreshService(
        CandidateSnapshotRepository(database_path),
        [
            CatalystReportSource(configured.catalyst_report_path),
            UserStrategySnapshotSource(configured.user_strategy_snapshot_path),
            SmallCapAbsorptionSnapshotSource(configured.user_strategy_snapshot_path),
        ],
    )
    morning_reports = morning_report_service or MorningReportService(
        MorningReportRepository(database_path),
        CatalystMorningReportAdapter(configured.catalyst_report_path),
    )
    coordinator = refresh_coordinator or CandidateRefreshCoordinator(
        RefreshTaskRepository(database_path),
        service,
        [SubprocessCandidateWorker(command) for command in configured.worker_commands],
        morning_report_service=morning_reports,
    )
    job_scheduler = scheduler or build_scheduler(
        timezone_name=configured.timezone_name,
        mom_refresh=mom_refreshes.start,
        directory_refresh=directory_refreshes.start,
        candidate_refresh=coordinator.start,
        mom_refresh_time=configured.mom_refresh_time,
        candidate_refresh_time=configured.candidate_refresh_time,
    )
    if model_profile_service is None:
        profile_repository = ModelProfileRepository(database_path)
        secret_store = FernetSecretStore(profile_repository, configured.model_master_key)
        provider_client = OpenAICompatibleProviderClient(
            production=configured.environment == "production",
            allow_private=configured.allow_private_model_endpoints,
        )
        profiles = ModelProfileService(
            profile_repository,
            secret_store,
            owner_id="local",
            provider_client=provider_client,
            platform_profiles=configured.platform_model_profiles,
            environment=os.environ,
        )
    else:
        profiles = model_profile_service
    analysis_http: httpx.AsyncClient | None = None
    if analysis_coordinator is None:
        route_signing_key = configured.route_signing_key
        if not route_signing_key and configured.environment != "production":
            route_signing_key = secrets.token_urlsafe(32)
        analysis_http = httpx.AsyncClient(
            base_url=configured.analysis_service_url,
            trust_env=False,
        )
        analyses = AnalysisCoordinator(
            AnalysisTaskRepository(database_path),
            profiles,
            IndividualAnalysisClient(analysis_http),
            RouteTokenIssuer(route_signing_key),
            owner_id="local",
        )
    else:
        analyses = analysis_coordinator

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if getattr(directory, "metadata", lambda: None)() is None:
            directory_refreshes.start()
        job_scheduler.start()
        yield
        job_scheduler.shutdown(wait=False)
        directory_refreshes.shutdown()
        mom_refreshes.shutdown()
        coordinator.shutdown()
        analyses.shutdown()
        if analysis_http is not None:
            await analysis_http.aclose()

    application = FastAPI(title="Star Dominion Stock Hub", version="0.5.0", lifespan=lifespan)

    async def current_user(request: Request) -> SiteIdentity:
        session_token = request.cookies.get("sd_session")
        if not session_token:
            raise HTTPException(status_code=401, detail="需要登录")
        verifier = site_auth_client
        if verifier is None:
            if len(configured.site_auth_internal_key) < 32:
                raise HTTPException(status_code=503, detail="统一认证服务尚未配置")
            verifier = SiteAuthClient(
                base_url=configured.site_auth_url,
                service_key=configured.site_auth_internal_key,
            )
        try:
            return await verifier.verify(
                session_token=session_token,
                csrf_cookie=request.cookies.get("sd_csrf"),
                method=request.method,
                origin=request.headers.get("origin"),
                csrf_header=request.headers.get("x-csrf-token"),
            )
        except SiteAuthRejected as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail="需要登录" if exc.status_code == 401 else "请求校验失败",
            ) from exc
        except ConnectionError as exc:
            raise HTTPException(status_code=503, detail="统一认证服务暂时不可用") from exc

    async def current_admin(request: Request) -> SiteIdentity:
        identity = await current_user(request)
        if identity.role != "admin":
            raise HTTPException(status_code=403, detail="需要管理员权限")
        return identity

    def profiles_for(owner_id: str) -> ModelProfileService:
        binder = getattr(profiles, "for_owner", None)
        return binder(owner_id) if binder is not None else profiles

    @application.get("/api/v1/health")
    def health() -> dict:
        return {"service": "stock-hub", "status": "ok", "version": "0.5.0"}

    @application.get("/api/v1/stocks/search")
    def search_stocks(
        q: str = Query(min_length=1),
        limit: int = Query(default=20, ge=1, le=50),
    ) -> dict:
        metadata = getattr(directory, "metadata", lambda: None)()
        return {
            "items": [item.model_dump() for item in directory.search(q, limit)],
            "directory": metadata.model_dump(mode="json") if metadata is not None else None,
        }

    @application.get(
        "/api/v1/stocks/{symbol}/research-context",
        response_model=StockResearchContext,
    )
    def stock_research_context(symbol: str) -> StockResearchContext:
        try:
            return morning_reports.research_context(symbol, service.get_candidates())
        except InvalidMainBoardSymbol as exc:
            raise HTTPException(
                status_code=422,
                detail={"code": "MAIN_BOARD_ONLY", "message": str(exc)},
            ) from exc

    @application.get(
        "/api/v1/stocks/{symbol}/kline",
        response_model=StockKline,
    )
    def stock_kline(
        symbol: str,
        response: Response,
        days: int = Query(default=60),
    ) -> StockKline:
        response.headers["Cache-Control"] = "no-store"
        if days not in (20, 60, 120):
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "INVALID_KLINE_DAYS",
                    "message": "K线周期仅支持 20、60 或 120 个交易日",
                },
            )
        try:
            return klines.get(symbol, days=days)
        except InvalidMainBoardSymbol as exc:
            raise HTTPException(
                status_code=422,
                detail={"code": "MAIN_BOARD_ONLY", "message": str(exc)},
            ) from exc
        except KlineUnavailable as exc:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "KLINE_UNAVAILABLE",
                    "message": "当前真实行情暂不可用",
                },
            ) from exc

    @application.get("/api/v1/candidates")
    def candidates() -> dict:
        return service.get_candidates().model_dump(mode="json")

    @application.post("/api/v1/candidates/refresh", status_code=status.HTTP_202_ACCEPTED)
    def refresh_candidates(_: SiteIdentity = Depends(current_admin)) -> dict:
        return coordinator.start().model_dump(mode="json")

    @application.get(
        "/api/v1/morning-report/current",
        response_model=MorningReport,
    )
    def current_morning_report() -> MorningReport:
        try:
            return morning_reports.current_summary()
        except MorningReportUnavailable as exc:
            raise HTTPException(
                status_code=404,
                detail={"code": "MORNING_REPORT_NOT_FOUND", "message": str(exc)},
            ) from exc

    @application.post(
        "/api/v1/morning-report/refresh",
        status_code=status.HTTP_202_ACCEPTED,
    )
    def refresh_morning_report(_: SiteIdentity = Depends(current_admin)) -> dict:
        return coordinator.start().model_dump(mode="json")

    @application.get(
        "/api/v1/morning-reports",
        response_model=MorningReportHistoryResponse,
    )
    def morning_report_history(
        limit: int = Query(default=20, ge=1, le=100),
    ) -> MorningReportHistoryResponse:
        return morning_reports.history(limit)

    @application.get(
        "/api/v1/morning-reports/{report_date}",
        response_model=MorningReport,
    )
    def dated_morning_report(report_date: date) -> MorningReport:
        report = morning_reports.get(report_date)
        if report is None:
            raise HTTPException(
                status_code=404,
                detail={"code": "MORNING_REPORT_NOT_FOUND", "message": "晨报不存在"},
            )
        return report

    @application.get("/api/v1/candidates/refresh/{task_id}")
    def refresh_status(
        task_id: str,
        _: SiteIdentity = Depends(current_admin),
    ) -> dict:
        task = coordinator.get(task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="刷新任务不存在")
        return task.model_dump(mode="json")

    @application.post(
        "/api/v1/stocks/directory/refresh",
        status_code=status.HTTP_202_ACCEPTED,
    )
    def refresh_stock_directory(_: SiteIdentity = Depends(current_admin)) -> dict:
        return directory_refreshes.start().model_dump(mode="json")

    @application.get(
        "/api/v1/stocks/directory/refresh/{task_id}",
    )
    def stock_directory_refresh_status(
        task_id: str,
        _: SiteIdentity = Depends(current_admin),
    ) -> dict:
        task = directory_refreshes.get(task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="股票目录刷新任务不存在")
        return task.model_dump(mode="json")

    @application.get(
        "/api/v1/mom-index/current",
        response_model=MomIndexSnapshot,
    )
    def current_mom_index() -> MomIndexSnapshot:
        snapshot = mom_indexes.current()
        if snapshot is None:
            raise HTTPException(
                status_code=404,
                detail={"code": "MOM_INDEX_NOT_FOUND", "message": "暂无真实宝妈指数"},
            )
        return snapshot

    @application.get(
        "/api/v1/mom-index/history",
        response_model=MomIndexHistoryResponse,
    )
    def mom_index_history(
        limit: int = Query(default=30, ge=1, le=100),
    ) -> MomIndexHistoryResponse:
        return MomIndexHistoryResponse(items=mom_indexes.history(limit))

    @application.post(
        "/api/v1/mom-index/refresh",
        status_code=status.HTTP_202_ACCEPTED,
    )
    def refresh_mom_index(_: SiteIdentity = Depends(current_admin)) -> dict:
        return mom_refreshes.start().model_dump(mode="json")

    @application.get("/api/v1/mom-index/refresh/{task_id}")
    def mom_index_refresh_status(
        task_id: str,
        _: SiteIdentity = Depends(current_admin),
    ) -> dict:
        task = mom_refreshes.get(task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="宝妈指数刷新任务不存在")
        return task.model_dump(mode="json")

    @application.post("/api/v1/mom-index/xhs/login")
    async def start_xhs_login(_: SiteIdentity = Depends(current_admin)) -> dict:
        return await xhs_logins.start()

    @application.get("/api/v1/mom-index/xhs/login/{session_id}")
    async def poll_xhs_login(
        session_id: str,
        _: SiteIdentity = Depends(current_admin),
    ) -> dict:
        return await xhs_logins.poll(session_id)

    @application.get("/api/v1/mom-index/xhs/status")
    async def xhs_login_status(_: SiteIdentity = Depends(current_admin)) -> dict:
        return await xhs_logins.status()

    @application.post(
        "/api/v1/analyses",
        response_model=AnalysisTaskPublic,
        status_code=status.HTTP_202_ACCEPTED,
    )
    def create_analysis(
        request: AnalysisCreate,
        identity: SiteIdentity = Depends(current_user),
    ) -> AnalysisTaskPublic:
        try:
            return AnalysisTaskPublic.from_task(
                analyses.start(
                    request,
                    owner_id=identity.id,
                    profiles=profiles_for(identity.id),
                )
            )
        except ModelProfileNotFound as exc:
            raise HTTPException(
                status_code=404,
                detail={"code": "MODEL_PROFILE_NOT_FOUND", "message": "模型配置不存在"},
            ) from exc
        except LookupError as exc:
            raise HTTPException(
                status_code=400,
                detail={"code": "MODEL_PROFILE_DISABLED", "message": "模型配置未启用"},
            ) from exc

    @application.get(
        "/api/v1/analyses/{task_id}",
        response_model=AnalysisTaskPublic,
    )
    def get_analysis(
        task_id: str,
        identity: SiteIdentity = Depends(current_user),
    ) -> AnalysisTaskPublic:
        task = analyses.get(task_id, owner_id=identity.id)
        if task is None:
            raise HTTPException(
                status_code=404,
                detail={"code": "ANALYSIS_NOT_FOUND", "message": "分析任务不存在"},
            )
        return AnalysisTaskPublic.from_task(task)

    @application.get(
        "/api/v1/analyses/{task_id}/report",
        response_model=AnalysisReportPublic,
    )
    def get_analysis_report(
        task_id: str,
        identity: SiteIdentity = Depends(current_user),
    ) -> AnalysisReportPublic:
        task = analyses.get(task_id, owner_id=identity.id)
        if task is None:
            raise HTTPException(
                status_code=404,
                detail={"code": "ANALYSIS_NOT_FOUND", "message": "分析任务不存在"},
            )
        if task.state != "succeeded" or task.report is None:
            raise HTTPException(
                status_code=409,
                detail={"code": "ANALYSIS_NOT_READY", "message": "分析报告尚未生成"},
            )
        return AnalysisReportPublic(task_id=task.task_id, report=task.report)

    @application.get("/api/v1/model-profiles")
    def list_model_profiles(identity: SiteIdentity = Depends(current_user)) -> dict:
        bound = profiles_for(identity.id)
        return {"items": [item.model_dump(mode="json") for item in bound.list_available()]}

    @application.post(
        "/api/v1/model-profiles",
        response_model=ModelProfilePublic,
        status_code=status.HTTP_201_CREATED,
    )
    def create_model_profile(
        request: ModelProfileCreate,
        identity: SiteIdentity = Depends(current_user),
    ) -> ModelProfilePublic:
        return profiles_for(identity.id).create(request)

    @application.patch(
        "/api/v1/model-profiles/{profile_id}",
        response_model=ModelProfilePublic,
    )
    def update_model_profile(
        profile_id: str,
        request: ModelProfileUpdate,
        identity: SiteIdentity = Depends(current_user),
    ) -> ModelProfilePublic:
        try:
            return profiles_for(identity.id).update(profile_id, request)
        except ModelProfileNotFound as exc:
            raise HTTPException(status_code=404, detail={"code": "MODEL_PROFILE_NOT_FOUND", "message": "模型配置不存在"}) from exc

    @application.delete("/api/v1/model-profiles/{profile_id}", status_code=204)
    def delete_model_profile(
        profile_id: str,
        identity: SiteIdentity = Depends(current_user),
    ) -> Response:
        try:
            profiles_for(identity.id).delete(profile_id)
        except ModelProfileNotFound as exc:
            raise HTTPException(status_code=404, detail={"code": "MODEL_PROFILE_NOT_FOUND", "message": "模型配置不存在"}) from exc
        return Response(status_code=204)

    @application.get(
        "/api/v1/model-profiles/{profile_id}/models",
        response_model=ModelCatalogResponse,
    )
    async def get_profile_models(
        profile_id: str,
        identity: SiteIdentity = Depends(current_user),
    ) -> ModelCatalogResponse:
        bound = profiles_for(identity.id)
        return ModelCatalogResponse(items=await _model_call(lambda: bound.get_models(profile_id)))

    @application.post(
        "/api/v1/model-profiles/{profile_id}/models/refresh",
        response_model=ModelCatalogResponse,
    )
    async def refresh_profile_models(
        profile_id: str,
        identity: SiteIdentity = Depends(current_user),
    ) -> ModelCatalogResponse:
        bound = profiles_for(identity.id)
        return ModelCatalogResponse(items=await _model_call(lambda: bound.refresh_models(profile_id)))

    @application.post(
        "/api/v1/model-profiles/{profile_id}/test",
        response_model=ModelConnectionTestResponse,
    )
    async def test_model_profile(
        profile_id: str,
        request: ModelConnectionTestRequest,
        identity: SiteIdentity = Depends(current_user),
    ) -> ModelConnectionTestResponse:
        bound = profiles_for(identity.id)
        result = await _model_call(
            lambda: bound.test_connection(profile_id, model=request.model)
        )
        if isinstance(result, list):
            return ModelConnectionTestResponse(ok=True, models=result)
        return ModelConnectionTestResponse(ok=result.ok, latency_ms=result.latency_ms)

    return application


async def _model_call(operation):
    try:
        return await operation()
    except ModelProfileNotFound as exc:
        raise HTTPException(status_code=404, detail={"code": "MODEL_PROFILE_NOT_FOUND", "message": "模型配置不存在"}) from exc
    except (SecretNotFound, KeyError) as exc:
        raise HTTPException(status_code=400, detail={"code": "MODEL_KEY_NOT_CONFIGURED", "message": "模型 API Key 尚未配置"}) from exc
    except UnsafeModelEndpoint as exc:
        raise HTTPException(status_code=400, detail={"code": "UNSAFE_MODEL_ENDPOINT", "message": str(exc)}) from exc
    except ModelProviderError as exc:
        raise HTTPException(status_code=400, detail={"code": exc.code, "message": _safe_model_message(exc.code)}) from exc


def _safe_model_message(code: str) -> str:
    messages = {
        "MODEL_AUTH_FAILED": "API Key 无效或无权访问该服务",
        "MODEL_QUOTA_EXCEEDED": "模型账户余额或配额不足",
        "MODEL_UNAVAILABLE": "所选模型或接口不存在",
        "MODEL_RATE_LIMITED": "模型服务当前限流，请稍后重试",
        "MODEL_PROVIDER_TIMEOUT": "模型服务响应超时",
        "MODEL_PROVIDER_UNAVAILABLE": "模型服务暂时不可用",
    }
    return messages.get(code, "模型服务请求失败")


app = create_app()
