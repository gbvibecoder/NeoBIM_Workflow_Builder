"""Direct R2 upload via boto3 (S3-compatible)."""

from __future__ import annotations

import base64
from datetime import datetime

import boto3
import structlog

from app.config import settings

log = structlog.get_logger()


def _get_s3_client():
    """Create an S3 client configured for Cloudflare R2."""
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
    )


def upload_ifc_to_r2(
    content: bytes,
    filename: str,
) -> str | None:
    """Upload IFC file bytes to R2 and return the public URL.

    Returns None if R2 is not configured or upload fails.
    Key structure: ifc/{YYYY}/{MM}/{DD}/{filename}
    """
    if not settings.r2_configured:
        log.warning("r2_not_configured", msg="Skipping R2 upload — credentials not set")
        return None

    now = datetime.utcnow()
    key = f"ifc/{now.year}/{now.month:02d}/{now.day:02d}/{filename}"

    try:
        client = _get_s3_client()
        client.put_object(
            Bucket=settings.r2_bucket_name,
            Key=key,
            Body=content,
            ContentType="application/x-step",
        )
        url = f"{settings.r2_public_url}/{key}"
        log.info("r2_upload_success", key=key, size=len(content))
        return url

    except Exception as e:
        log.error("r2_upload_failed", key=key, error=str(e))
        return None


def ifc_to_base64_data_uri(content: bytes) -> str:
    """Convert IFC bytes to a base64 data URI (fallback when R2 unavailable)."""
    b64 = base64.b64encode(content).decode("ascii")
    return f"data:application/x-step;base64,{b64}"
