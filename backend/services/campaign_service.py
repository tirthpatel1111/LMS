"""
Campaign Service — handles email and WhatsApp campaign operations.
Manages campaign creation, sending, and logging.
"""

import aiosqlite
from datetime import datetime


async def create_campaign(
    db: aiosqlite.Connection,
    lead_id: int,
    owner_id: int,
    campaign_type: str,
    subject: str = None,
    message: str = "",
    status: str = "pending",
) -> dict:
    """
    Create a new campaign record in the database.
    """
    cursor = await db.execute(
        """
        INSERT INTO campaigns (lead_id, owner_id, campaign_type, subject, message, status)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (lead_id, owner_id, campaign_type, subject, message, status),
    )
    await db.commit()
    campaign_id = cursor.lastrowid
    return await get_campaign_by_id(db, campaign_id)


async def get_campaign_by_id(db: aiosqlite.Connection, campaign_id: int) -> dict | None:
    """Retrieve a single campaign by ID."""
    cursor = await db.execute("SELECT * FROM campaigns WHERE id = ?", (campaign_id,))
    row = await cursor.fetchone()
    return dict(row) if row else None


async def update_campaign_status(
    db: aiosqlite.Connection,
    campaign_id: int,
    status: str,
    error_message: str = None,
) -> dict:
    """
    Update campaign status after sending attempt.
    Sets sent_at timestamp on success.
    """
    sent_at = datetime.utcnow().isoformat() if status == "sent" else None
    await db.execute(
        """
        UPDATE campaigns 
        SET status = ?, sent_at = ?, error_message = ?
        WHERE id = ?
        """,
        (status, sent_at, error_message, campaign_id),
    )
    await db.commit()
    return await get_campaign_by_id(db, campaign_id)


async def get_campaigns_for_user(
    db: aiosqlite.Connection,
    user_id: int,
    role: str,
    campaign_type: str = None,
) -> list:
    """
    Retrieve campaigns filtered by owner.
    Admin sees all; salesperson sees only their own.
    Includes lead info via JOIN.
    """
    query = """
        SELECT c.*, l.company_name, l.contact_name, l.email as lead_email,
               l.phone as lead_phone, l.status as lead_status
        FROM campaigns c
        LEFT JOIN leads l ON c.lead_id = l.id
    """
    params = []
    conditions = []

    if role != "admin":
        conditions.append("c.owner_id = ?")
        params.append(user_id)

    if campaign_type:
        conditions.append("c.campaign_type = ?")
        params.append(campaign_type)

    if conditions:
        query += " WHERE " + " AND ".join(conditions)

    query += " ORDER BY c.created_at DESC"

    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    return [dict(row) for row in rows]


async def get_campaign_stats(
    db: aiosqlite.Connection, user_id: int, role: str
) -> dict:
    """
    Get campaign statistics for the dashboard.
    """
    owner_filter = "" if role == "admin" else " WHERE owner_id = ?"
    params = [] if role == "admin" else [user_id]

    # Total campaigns
    cursor = await db.execute(f"SELECT COUNT(*) as count FROM campaigns{owner_filter}", params)
    total = dict(await cursor.fetchone())["count"]

    # Campaigns by type
    type_query = f"""
        SELECT campaign_type, COUNT(*) as count 
        FROM campaigns{owner_filter} 
        GROUP BY campaign_type
    """
    cursor = await db.execute(type_query, params)
    type_rows = await cursor.fetchall()
    by_type = {row["campaign_type"]: row["count"] for row in type_rows}

    # Successful campaigns
    success_filter = " WHERE status = 'sent'" if role == "admin" else " WHERE status = 'sent' AND owner_id = ?"
    success_params = [] if role == "admin" else [user_id]
    cursor = await db.execute(f"SELECT COUNT(*) as count FROM campaigns{success_filter}", success_params)
    sent = dict(await cursor.fetchone())["count"]

    return {
        "total": total,
        "sent": sent,
        "email": by_type.get("email", 0),
        "whatsapp": by_type.get("whatsapp", 0),
    }
