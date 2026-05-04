"""
Database module — SQLite connection management and table initialization.
Uses aiosqlite for async operations with FastAPI.
"""

import os
import aiosqlite
from backend.config import DB_PATH


async def get_db():
    """
    Async generator that yields a database connection.
    Used as a FastAPI dependency for route handlers.
    Enables foreign key enforcement and returns rows as dictionaries.
    """
    # Ensure the data directory exists
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

    db = await aiosqlite.connect(DB_PATH)
    # Enable foreign key constraints (off by default in SQLite)
    await db.execute("PRAGMA foreign_keys = ON")
    # Return rows as sqlite3.Row (dict-like access)
    db.row_factory = aiosqlite.Row
    try:
        yield db
    finally:
        await db.close()


async def init_db():
    """
    Create all tables if they don't exist.
    Called once on application startup.
    """
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON")

        # ── Users Table ──────────────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'salesperson')),
                email TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active INTEGER DEFAULT 1
            )
        """)

        # ── Leads Table ──────────────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_id INTEGER NOT NULL,
                company_name TEXT,
                contact_name TEXT,
                email TEXT,
                phone TEXT,
                source TEXT DEFAULT 'manual',
                notes TEXT,
                status TEXT DEFAULT 'new',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id) REFERENCES users(id)
            )
        """)

        # ── Campaigns Table ──────────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS campaigns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lead_id INTEGER NOT NULL,
                owner_id INTEGER NOT NULL,
                campaign_type TEXT NOT NULL CHECK(campaign_type IN ('email', 'whatsapp')),
                subject TEXT,
                message TEXT,
                status TEXT DEFAULT 'pending',
                sent_at TIMESTAMP,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (lead_id) REFERENCES leads(id),
                FOREIGN KEY (owner_id) REFERENCES users(id)
            )
        """)

        # ── Meetings Table ────────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS meetings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lead_id INTEGER NOT NULL UNIQUE,
                owner_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                start_datetime TEXT NOT NULL,
                duration_minutes INTEGER DEFAULT 60,
                attendee_email TEXT,
                salesperson_email TEXT,
                event_id TEXT,
                event_link TEXT,
                meet_link TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (lead_id) REFERENCES leads(id),
                FOREIGN KEY (owner_id) REFERENCES users(id)
            )
        """)

        # ── Migration: add salesperson_email to existing meetings table ──
        try:
            await db.execute("ALTER TABLE meetings ADD COLUMN salesperson_email TEXT")
        except Exception:
            pass  # Column already exists

        # ── System Settings Table ─────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)

        # ── WhatsApp Templates Table ──────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS whatsapp_templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                code_name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # ── Email Templates Table ─────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS email_templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                html_body TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # ── Website Leads Table ───────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS website_leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lead_id INTEGER NOT NULL UNIQUE,
                category TEXT NOT NULL CHECK(category IN ('POSH', 'Contact Us')),
                full_data TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
            )
        """)

        await db.commit()
        print("[OK] Database tables initialized successfully.")
