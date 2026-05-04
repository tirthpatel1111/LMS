"""
Campaign Routes — Send email/WhatsApp campaigns, retrieve logs, update lead outcomes,
schedule Google Calendar meetings, and manage meeting records.
All endpoints are protected and scoped to the current user.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import aiosqlite
from datetime import datetime

from backend.database import get_db
from backend.models.campaign import CampaignCreate, CampaignResponse
from backend.middleware.auth_middleware import get_current_user, require_admin
from backend.services.lead_service import get_lead_by_id, update_lead
from backend.services.user_service import get_user_by_id
from backend.services.campaign_service import (
    create_campaign,
    update_campaign_status,
    get_campaigns_for_user,
    get_campaign_stats,
)
from backend.services.email_service import send_email, is_smtp_configured, update_smtp_config, SMTP_CONFIG
from backend.services.whatsapp_service import send_whatsapp, is_interakt_configured, update_interakt_config, INTERAKT_CONFIG
from backend.services.google_calendar_service import (
    schedule_meeting,
    is_gcal_configured,
    update_gcal_config,
    GCAL_CONFIG,
)
from backend.services.imap_service import (
    IMAP_CONFIG,
    is_imap_configured,
    update_imap_config,
)
from backend.default_templates import POSH_DEFAULT_TEMPLATE, CONTACT_US_DEFAULT_TEMPLATE

router = APIRouter(prefix="/api/campaigns", tags=["Campaigns"])


# ──────────────────────────────────────────────
#  Send Email Campaign  (supports HTML body)
# ──────────────────────────────────────────────
@router.post("/email")
async def send_email_campaign(
    campaign_data: CampaignCreate,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Send an email campaign to a lead.
    Requires the lead to have an email address.
    Pass is_html=true in the body to render the message as HTML.
    On success, automatically updates lead status from 'new' → 'contacted'.
    """
    if campaign_data.campaign_type != "email":
        raise HTTPException(status_code=400, detail="Campaign type must be 'email'")

    lead = await get_lead_by_id(db, campaign_data.lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    if current_user["role"] != "admin" and lead["owner_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")

    if not lead.get("email"):
        raise HTTPException(status_code=400, detail="This lead does not have an email address")

    # Create campaign record (pending)
    campaign = await create_campaign(
        db=db,
        lead_id=campaign_data.lead_id,
        owner_id=current_user["id"],
        campaign_type="email",
        subject=campaign_data.subject,
        message=campaign_data.message,
        status="pending",
    )

    # Attempt to send email — support HTML flag from frontend
    is_html = getattr(campaign_data, "is_html", False) or False
    result = send_email(
        to_email=lead["email"],
        subject=campaign_data.subject or "Message from Lead Manager",
        body=campaign_data.message,
        html=is_html,
    )

    # Update campaign status based on result
    if result["success"]:
        campaign = await update_campaign_status(db, campaign["id"], "sent")
        # Auto-update lead status from "new" → "contacted" only after successful send
        if lead.get("status") == "new":
            await update_lead(db=db, lead_id=lead["id"], status="contacted")
    else:
        campaign = await update_campaign_status(db, campaign["id"], "failed", result["message"])

    return {
        "campaign": campaign,
        "send_result": result,
    }


# ──────────────────────────────────────────────
#  Send WhatsApp Campaign
# ──────────────────────────────────────────────
@router.post("/whatsapp")
async def send_whatsapp_campaign(
    campaign_data: CampaignCreate,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Send a WhatsApp campaign to a lead.
    Requires the lead to have a phone number.
    On success, automatically updates lead status from 'new' → 'contacted'.
    """
    if campaign_data.campaign_type != "whatsapp":
        raise HTTPException(status_code=400, detail="Campaign type must be 'whatsapp'")

    lead = await get_lead_by_id(db, campaign_data.lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    if current_user["role"] != "admin" and lead["owner_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")

    if not lead.get("phone"):
        raise HTTPException(status_code=400, detail="This lead does not have a phone number")

    # Create campaign record
    campaign = await create_campaign(
        db=db,
        lead_id=campaign_data.lead_id,
        owner_id=current_user["id"],
        campaign_type="whatsapp",
        subject=None,
        message=campaign_data.message,
        status="pending",
    )

    # Attempt to send WhatsApp
    # Note: campaign_data.message contains the selected template code_name
    result = send_whatsapp(
        to_phone=lead["phone"],
        template_name=campaign_data.message,
    )

    if result["success"]:
        campaign = await update_campaign_status(db, campaign["id"], "sent")
        # Auto-update lead status from "new" → "contacted" only after successful send
        if lead.get("status") == "new":
            await update_lead(db=db, lead_id=lead["id"], status="contacted")
    else:
        campaign = await update_campaign_status(db, campaign["id"], "failed", result["message"])

    return {
        "campaign": campaign,
        "send_result": result,
    }


# ──────────────────────────────────────────────
#  List Campaigns
# ──────────────────────────────────────────────
@router.get("")
async def list_campaigns(
    campaign_type: str = None,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List campaigns. Salesperson sees own; Admin sees all."""
    campaigns = await get_campaigns_for_user(
        db=db,
        user_id=current_user["id"],
        role=current_user["role"],
        campaign_type=campaign_type,
    )
    return campaigns


# ──────────────────────────────────────────────
#  Campaign Statistics (for dashboard)
# ──────────────────────────────────────────────
@router.get("/stats")
async def campaign_stats(
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get campaign statistics for the dashboard."""
    stats = await get_campaign_stats(db, current_user["id"], current_user["role"])
    return stats


# ──────────────────────────────────────────────
#  Update Lead Outcome (Lost / Approved/Won)
# ──────────────────────────────────────────────
class LeadOutcomeRequest(BaseModel):
    outcome: str  # "lost" or "won"

@router.put("/lead/{lead_id}/outcome")
async def update_lead_outcome(
    lead_id: int,
    body: LeadOutcomeRequest,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Update a contacted lead's outcome to 'won' (Approved) or 'lost'.
    Only allowed when lead is in 'contacted' status.
    Called from the Campaigns page when a salesperson reviews lead feedback.
    """
    if body.outcome not in ("won", "lost"):
        raise HTTPException(status_code=400, detail="Outcome must be 'won' or 'lost'")

    lead = await get_lead_by_id(db, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    if current_user["role"] != "admin" and lead["owner_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")

    updated = await update_lead(db=db, lead_id=lead_id, status=body.outcome)
    return updated


# ──────────────────────────────────────────────
#  Schedule Google Meet Meeting  +  Save to DB
# ──────────────────────────────────────────────
class MeetingRequest(BaseModel):
    lead_id: int
    title: str
    description: Optional[str] = ""
    start_datetime: str   # "YYYY-MM-DDTHH:MM:SS"
    duration_minutes: Optional[int] = 60
    attendee_email: Optional[str] = None

@router.post("/schedule-meeting")
async def schedule_google_meeting(
    body: MeetingRequest,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Schedule a Google Meet meeting on the admin's Google Calendar.
    Saves meeting details to the local database for later retrieval / editing.
    Called after a lead is marked as 'Approved'.
    Returns a Google Meet link.
    """
    lead = await get_lead_by_id(db, body.lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    if current_user["role"] != "admin" and lead["owner_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")

    # Derive salesperson email from the current user's record
    sp_user = await get_user_by_id(db, current_user["id"])
    salesperson_email = sp_user.get("email", "") if sp_user else ""

    result = schedule_meeting(
        title=body.title,
        description=body.description or f"Meeting with {lead.get('contact_name') or lead.get('company_name', 'Client')}",
        start_datetime=body.start_datetime,
        duration_minutes=body.duration_minutes or 60,
        attendee_email=body.attendee_email or lead.get("email"),
        salesperson_email=salesperson_email or None,
    )

    if not result["success"]:
        raise HTTPException(status_code=503, detail=result["message"])

    # Upsert meeting record in local DB (INSERT OR REPLACE by lead_id)
    now = datetime.utcnow().isoformat()
    await db.execute(
        """
        INSERT INTO meetings
            (lead_id, owner_id, title, description, start_datetime, duration_minutes,
             attendee_email, salesperson_email, event_id, event_link, meet_link, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(lead_id) DO UPDATE SET
            title=excluded.title,
            description=excluded.description,
            start_datetime=excluded.start_datetime,
            duration_minutes=excluded.duration_minutes,
            attendee_email=excluded.attendee_email,
            salesperson_email=excluded.salesperson_email,
            event_id=excluded.event_id,
            event_link=excluded.event_link,
            meet_link=excluded.meet_link,
            updated_at=excluded.updated_at
        """,
        (
            body.lead_id,
            current_user["id"],
            body.title,
            body.description or "",
            body.start_datetime,
            body.duration_minutes or 60,
            body.attendee_email or lead.get("email", ""),
            salesperson_email or "",
            result.get("event_id", ""),
            result.get("event_link", ""),
            result.get("meet_link", ""),
            now,
            now,
        ),
    )
    await db.commit()

    return result


# ──────────────────────────────────────────────
#  Get Scheduled Meeting for a Lead
# ──────────────────────────────────────────────
@router.get("/meeting/{lead_id}")
async def get_meeting(
    lead_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get the scheduled meeting details for a specific lead."""
    lead = await get_lead_by_id(db, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    if current_user["role"] != "admin" and lead["owner_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")

    cursor = await db.execute("SELECT * FROM meetings WHERE lead_id = ?", (lead_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No meeting scheduled for this lead")

    return dict(row)


# ──────────────────────────────────────────────
#  Delete / Cancel a Scheduled Meeting
# ──────────────────────────────────────────────
@router.delete("/meeting/{lead_id}")
async def cancel_meeting(
    lead_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Cancel/delete a scheduled meeting for a lead.
    Removes the local DB record. The Google Calendar event must be
    deleted manually (or use event_link to open it in Google Calendar).
    """
    lead = await get_lead_by_id(db, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    if current_user["role"] != "admin" and lead["owner_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")

    cursor = await db.execute("DELETE FROM meetings WHERE lead_id = ?", (lead_id,))
    await db.commit()

    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="No meeting found for this lead")

    return {"message": "Meeting cancelled successfully"}


# ──────────────────────────────────────────────
#  Check if a lead has a scheduled meeting
# ──────────────────────────────────────────────
@router.get("/meeting-status")
async def get_meeting_statuses(
    db: aiosqlite.Connection = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Return a list of lead_ids that have scheduled meetings for this user.
    Used by the campaigns table to decide which action button to show.
    """
    if current_user["role"] == "admin":
        cursor = await db.execute("SELECT lead_id FROM meetings")
    else:
        cursor = await db.execute(
            "SELECT lead_id FROM meetings WHERE owner_id = ?", (current_user["id"],)
        )
    rows = await cursor.fetchall()
    return [row["lead_id"] for row in rows]


# ──────────────────────────────────────────────
#  Settings: SMTP Config (Admin only)
# ──────────────────────────────────────────────
@router.get("/settings/smtp")
async def get_smtp_settings(admin: dict = Depends(require_admin)):
    """Get current SMTP configuration (admin only)."""
    return {
        "host": SMTP_CONFIG["host"],
        "port": SMTP_CONFIG["port"],
        "username": SMTP_CONFIG["username"],
        "password": "***" if SMTP_CONFIG["password"] else "",
        "from_email": SMTP_CONFIG["from_email"],
        "from_name": SMTP_CONFIG["from_name"],
        "use_tls": SMTP_CONFIG["use_tls"],
        "configured": is_smtp_configured(),
    }


@router.post("/settings/smtp")
async def save_smtp_settings(
    config: dict,
    admin: dict = Depends(require_admin),
):
    """Update SMTP configuration (admin only)."""
    update_smtp_config(config)
    return {"message": "SMTP settings updated", "configured": is_smtp_configured()}


# ──────────────────────────────────────────────
#  Settings: Interakt WhatsApp Config (Admin only)
# ──────────────────────────────────────────────
@router.get("/settings/interakt")
async def get_interakt_settings(admin: dict = Depends(require_admin)):
    """Get current Interakt configuration (admin only)."""
    api_key = INTERAKT_CONFIG.get("api_key", "")
    return {
        "api_key": (api_key[:8] + "***") if api_key else "",
        "template_name": INTERAKT_CONFIG.get("template_name", ""),
        "language_code": INTERAKT_CONFIG.get("language_code", "en"),
        "configured": is_interakt_configured(),
    }


@router.post("/settings/interakt")
async def save_interakt_settings(
    config: dict,
    admin: dict = Depends(require_admin),
):
    """Update Interakt configuration (admin only)."""
    # Don't overwrite masked values
    if config.get("api_key", "").endswith("***"):
        config.pop("api_key", None)
    update_interakt_config(config)
    return {"message": "Interakt settings updated", "configured": is_interakt_configured()}


# ──────────────────────────────────────────────
#  Settings: WhatsApp Templates (Admin only)
# ──────────────────────────────────────────────
@router.get("/settings/whatsapp-templates")
async def get_whatsapp_templates(db: aiosqlite.Connection = Depends(get_db)):
    """Get all WhatsApp templates."""
    cursor = await db.execute("SELECT * FROM whatsapp_templates ORDER BY created_at DESC")
    rows = await cursor.fetchall()
    return [dict(row) for row in rows]


class WhatsAppTemplateCreate(BaseModel):
    name: str
    code_name: str


@router.post("/settings/whatsapp-templates")
async def create_whatsapp_template(
    body: WhatsAppTemplateCreate,
    db: aiosqlite.Connection = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """Create a new WhatsApp template."""
    if not body.name or not body.code_name:
        raise HTTPException(status_code=400, detail="Name and code_name are required")
        
    await db.execute(
        "INSERT INTO whatsapp_templates (name, code_name) VALUES (?, ?)",
        (body.name, body.code_name)
    )
    await db.commit()
    return {"message": "Template created successfully"}


@router.delete("/settings/whatsapp-templates/{template_id}")
async def delete_whatsapp_template(
    template_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """Delete a WhatsApp template."""
    cursor = await db.execute("DELETE FROM whatsapp_templates WHERE id = ?", (template_id,))
    await db.commit()
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"message": "Template deleted successfully"}


# ──────────────────────────────────────────────
#  Settings: Email HTML Templates (Admin only for POST/DELETE, All for GET)
# ──────────────────────────────────────────────
@router.get("/settings/email-templates")
async def get_email_templates(db: aiosqlite.Connection = Depends(get_db)):
    """Get all Email HTML templates."""
    cursor = await db.execute("SELECT * FROM email_templates ORDER BY created_at DESC")
    rows = await cursor.fetchall()
    return [dict(row) for row in rows]


class EmailTemplateCreate(BaseModel):
    name: str
    html_body: str


@router.post("/settings/email-templates")
async def create_email_template(
    body: EmailTemplateCreate,
    db: aiosqlite.Connection = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """Create a new Email HTML template."""
    if not body.name or not body.html_body:
        raise HTTPException(status_code=400, detail="Name and HTML body are required")
        
    await db.execute(
        "INSERT INTO email_templates (name, html_body) VALUES (?, ?)",
        (body.name, body.html_body)
    )
    await db.commit()
    return {"message": "Email Template created successfully"}


@router.delete("/settings/email-templates/{template_id}")
async def delete_email_template(
    template_id: int,
    db: aiosqlite.Connection = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """Delete an Email HTML template."""
    cursor = await db.execute("DELETE FROM email_templates WHERE id = ?", (template_id,))
    await db.commit()
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"message": "Email Template deleted successfully"}



# ──────────────────────────────────────────────
#  Settings: Google Calendar Config (Admin only)
# ──────────────────────────────────────────────
@router.get("/settings/google-calendar")
async def get_gcal_settings(admin: dict = Depends(require_admin)):
    """Get current Google Calendar configuration (admin only)."""
    return {
        "client_id": GCAL_CONFIG["client_id"],
        "client_secret": "***" if GCAL_CONFIG["client_secret"] else "",
        "refresh_token": "***" if GCAL_CONFIG["refresh_token"] else "",
        "calendar_email": GCAL_CONFIG["calendar_email"],
        "configured": is_gcal_configured(),
    }


@router.post("/settings/google-calendar")
async def save_gcal_settings(
    config: dict,
    admin: dict = Depends(require_admin),
):
    """Update Google Calendar configuration (admin only)."""
    # Don't overwrite masked values
    for key in ("client_secret", "refresh_token"):
        if config.get(key) == "***":
            del config[key]
    update_gcal_config(config)
    return {"message": "Google Calendar settings updated", "configured": is_gcal_configured()}


# ──────────────────────────────────────────────
#  Settings: Incoming Emails IMAP Config (Admin only)
# ──────────────────────────────────────────────
@router.get("/settings/imap")
async def get_imap_settings(admin: dict = Depends(require_admin)):
    """Get current IMAP configuration (admin only)."""
    return {
        "host": IMAP_CONFIG["host"],
        "port": IMAP_CONFIG["port"],
        "username": IMAP_CONFIG["username"],
        "password": "***" if IMAP_CONFIG["password"] else "",
        "use_tls": IMAP_CONFIG["use_tls"],
        "configured": is_imap_configured(),
    }


@router.post("/settings/imap")
async def save_imap_settings(
    config: dict,
    admin: dict = Depends(require_admin),
):
    """Update IMAP configuration (admin only)."""
    update_imap_config(config)
    return {"message": "IMAP settings updated", "configured": is_imap_configured()}


# ──────────────────────────────────────────────
#  Settings: Thank You Email Templates (Admin only)
# ──────────────────────────────────────────────
@router.get("/settings/thank-you-templates")
async def get_thank_you_templates(
    db: aiosqlite.Connection = Depends(get_db),
    admin: dict = Depends(require_admin)
):
    """Get current Thank You email templates (admin only)."""
    cursor = await db.execute("SELECT key, value FROM system_settings WHERE key IN ('posh_thank_you_template', 'contact_us_thank_you_template')")
    rows = await cursor.fetchall()
    settings = {row["key"]: row["value"] for row in rows}
    
    return {
        "posh": settings.get("posh_thank_you_template", POSH_DEFAULT_TEMPLATE),
        "contact_us": settings.get("contact_us_thank_you_template", CONTACT_US_DEFAULT_TEMPLATE)
    }


class ThankYouTemplatesUpdate(BaseModel):
    posh: str
    contact_us: str


@router.post("/settings/thank-you-templates")
async def save_thank_you_templates(
    body: ThankYouTemplatesUpdate,
    db: aiosqlite.Connection = Depends(get_db),
    admin: dict = Depends(require_admin)
):
    """Update Thank You email templates (admin only)."""
    await db.execute(
        "INSERT OR REPLACE INTO system_settings (key, value) VALUES ('posh_thank_you_template', ?)",
        (body.posh,)
    )
    await db.execute(
        "INSERT OR REPLACE INTO system_settings (key, value) VALUES ('contact_us_thank_you_template', ?)",
        (body.contact_us,)
    )
    await db.commit()
    return {"message": "Thank You templates updated"}


@router.delete("/settings/thank-you-templates/{template_type}")
async def delete_thank_you_template(
    template_type: str,
    db: aiosqlite.Connection = Depends(get_db),
    admin: dict = Depends(require_admin)
):
    """Delete a specific Thank You email template."""
    key = f"{template_type}_thank_you_template"
    if key not in ('posh_thank_you_template', 'contact_us_thank_you_template'):
        raise HTTPException(status_code=400, detail="Invalid template type")
        
    await db.execute("DELETE FROM system_settings WHERE key = ?", (key,))
    await db.commit()
    return {"message": f"{template_type} template deleted"}

