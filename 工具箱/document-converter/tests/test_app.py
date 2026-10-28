from pathlib import Path

from document_converter.app import app
from document_converter.converters import dependency_capabilities


def test_capabilities_are_json_serializable():
    capabilities = dependency_capabilities()
    assert set(capabilities) == {"libreoffice", "pdf", "pdf_tables", "ocr"}
    assert all(isinstance(value, bool) for value in capabilities.values())


def test_app_exposes_document_conversion_routes():
    paths = {route.path for route in app.routes}
    assert "/health" in paths
    assert "/api/v1/capabilities" in paths
    assert "/api/v1/convert" in paths
    assert "/api/v1/convert/batch" in paths
