"""
IMAP Service — Fetch emails, parse leads via LLM, and assign using round-robin.
"""

import os
import imaplib
import email
from email.header import decode_header
import json
import asyncio
from dotenv import load_dotenv, set_key

from backend.services.encryption_service import encrypt_text, decrypt_text

# Load environment variables
load_dotenv()
ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")

# ──────────────────────────────────────────────
#  IMAP Configuration
# ──────────────────────────────────────────────
IMAP_CONFIG = {
    "host": os.getenv("IMAP_HOST", ""),
    "port": int(os.getenv("IMAP_PORT", 993)),
    "username": os.getenv("IMAP_USERNAME", ""),
    "password": decrypt_text(os.getenv("IMAP_PASSWORD", "")),
    "use_tls": os.getenv("IMAP_USE_TLS", "True").lower() == "true",
}

def is_imap_configured() -> bool:
    """Check if IMAP settings are configured."""
    return bool(IMAP_CONFIG["host"] and IMAP_CONFIG["username"] and IMAP_CONFIG["password"])

def update_imap_config(config: dict):
    """
    Update IMAP configuration at runtime and persist to .env.
    """
    if not os.path.exists(ENV_PATH):
        open(ENV_PATH, 'a').close()

    for key, val in config.items():
        if key in IMAP_CONFIG:
            if key == "password" and val == "***":
                continue
            
            IMAP_CONFIG[key] = val
            env_key = f"IMAP_{key.upper()}"
            
            save_val = str(val)
            if key == "password":
                save_val = encrypt_text(val)
                
            set_key(ENV_PATH, env_key, save_val)

# ──────────────────────────────────────────────
#  Email Processing Logic
# ──────────────────────────────────────────────
import traceback
import re
import aiosqlite
from groq import Groq

from backend.config import DB_PATH
from backend.services.lead_service import create_lead
from backend.services.email_service import send_email
from backend.default_templates import POSH_DEFAULT_TEMPLATE, CONTACT_US_DEFAULT_TEMPLATE

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

async def get_next_salesperson(db: aiosqlite.Connection) -> int | None:
    """
    Round-robin logic to find the next active salesperson.
    """
    # 1. Get all active salespersons ordered by ID
    cursor = await db.execute("SELECT id FROM users WHERE role = 'salesperson' AND is_active = 1 ORDER BY id ASC")
    rows = await cursor.fetchall()
    active_salespersons = [row["id"] for row in rows]

    if not active_salespersons:
        # If no salespersons, assign to an admin
        cursor = await db.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY id ASC LIMIT 1")
        admin = await cursor.fetchone()
        return admin["id"] if admin else None

    # 2. Get last assigned user ID from system_settings
    cursor = await db.execute("SELECT value FROM system_settings WHERE key = 'last_assigned_salesperson_id'")
    row = await cursor.fetchone()
    last_id = int(row["value"]) if row else None

    # 3. Determine next user
    next_id = active_salespersons[0] # Default to first
    if last_id is not None and last_id in active_salespersons:
        idx = active_salespersons.index(last_id)
        if idx + 1 < len(active_salespersons):
            next_id = active_salespersons[idx + 1]

    # 4. Save the new last_assigned_salesperson_id
    await db.execute(
        "INSERT OR REPLACE INTO system_settings (key, value) VALUES ('last_assigned_salesperson_id', ?)",
        (str(next_id),)
    )
    await db.commit()

    return next_id

def extract_lead_data_via_llm(email_body: str, subject: str) -> dict:
    """
    Use Groq LLM to extract lead data from the email body.
    Handles variable formats cleanly based on category (POSH vs Contact Us).
    """
    if not GROQ_API_KEY:
        print("[IMAP] GROQ_API_KEY missing, cannot extract data.")
        return {}
        
    client = Groq(api_key=GROQ_API_KEY)
    
    is_posh = "posh" in subject.lower()
    
    if is_posh:
        fields = """
        - Name (or contact_person)
        - Phone
        - Email ID
        - Company Name
        - City
        - Services Interested In
        - POSH interest (e.g. Yes/No to the 15,000 cost question)
        - Training Mode
        - Number of Employees
        - Preferred Timeline
        - Requirement Message
        """
    else:
        fields = """
        - Name (or contact_person)
        - Phone
        - Email ID
        - Company Name
        - City
        - Website
        - Turnover
        - Employee Size
        - Requirement Message
        """

    prompt = f"""
    You are an information extraction system.
    Extract ONLY the following fields from the given email body about a new lead:
    {fields}
    
    Rules:
    - Return STRICT JSON only.
    - Use snake_case for the JSON keys (e.g., "name", "phone", "email_id", "company_name", "turnover", etc.).
    - Ensure 'name' and 'company_name' and 'phone' and 'email_id' are present.
    - If a field is missing, return null.
    - Do not include any explanations or markdown formatting outside the JSON block.
    
    Email Body:
    \"\"\"
    {email_body[:4000]}  # limit text length for safety
    \"\"\"
    """
    
    try:
        response = client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=300,
        )
        content = response.choices[0].message.content
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            return json.loads(match.group(0))
    except Exception as e:
        print(f"[IMAP] Groq LLM Error: {e}")
        
    return {}

def fetch_emails_sync():
    """Synchronous function to connect and fetch emails. Ran in a separate thread."""
    if not is_imap_configured():
        return []
        
    try:
        # Connect
        if IMAP_CONFIG["use_tls"]:
            mail = imaplib.IMAP4_SSL(IMAP_CONFIG["host"], IMAP_CONFIG["port"])
        else:
            mail = imaplib.IMAP4(IMAP_CONFIG["host"], IMAP_CONFIG["port"])
            
        mail.login(IMAP_CONFIG["username"], IMAP_CONFIG["password"])
        mail.select("inbox")
        
        # Search for UNSEEN
        status, messages = mail.search(None, "UNSEEN")
        if status != "OK" or not messages[0]:
            mail.logout()
            return []
            
        unseen_ids = messages[0].split()
        processed_data = []
        
        for msg_id in unseen_ids:
            # Fetch message parts
            status, msg_data = mail.fetch(msg_id, "(RFC822)")
            if status != "OK":
                continue
                
            for response_part in msg_data:
                if isinstance(response_part, tuple):
                    msg = email.message_from_bytes(response_part[1])
                    
                    # Parse subject
                    subject, encoding = decode_header(msg.get("Subject", ""))[0]
                    if isinstance(subject, bytes):
                        subject = subject.decode(encoding or "utf-8", errors="ignore")
                    
                    # Case insensitive check for "Website Lead"
                    if "website lead" in subject.lower():
                        # Extract body
                        body_content = ""
                        if msg.is_multipart():
                            for part in msg.walk():
                                content_type = part.get_content_type()
                                if content_type in ("text/plain", "text/html"):
                                    payload = part.get_payload(decode=True)
                                    if payload:
                                        body_content = payload.decode(errors="ignore")
                                        break # Prefer the first found text block
                        else:
                            payload = msg.get_payload(decode=True)
                            if payload:
                                body_content = payload.decode(errors="ignore")
                                
                        processed_data.append({
                            "subject": subject,
                            "body": body_content
                        })
                        
                        # Mark as Seen (Read)
                        mail.store(msg_id, '+FLAGS', '\Seen')
                    
        mail.logout()
        return processed_data
    except Exception as e:
        print(f"[IMAP] Fetch Error: {e}")
        traceback.print_exc()
        return []

async def process_incoming_emails():
    """Background task to fetch and process emails."""
    if not is_imap_configured():
        return
        
    # Fetch emails off main thread
    emails_to_process = await asyncio.to_thread(fetch_emails_sync)
    
    if not emails_to_process:
        return
        
    print(f"[IMAP] Found {len(emails_to_process)} 'Website Lead' emails. Processing...")
    
    # Process and add to DB
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        db.row_factory = aiosqlite.Row
        
        for email_data in emails_to_process:
            # 1. Extract JSON via LLM
            extracted = extract_lead_data_via_llm(email_data["body"], email_data["subject"])
            
            # 2. Get round-robin assignment
            owner_id = await get_next_salesperson(db)
            if not owner_id:
                print("[IMAP] Warning: No active salespersons or admins available to assign lead.")
                continue
                
            # 3. Create lead
            company_name = extracted.get("company_name") or extracted.get("company")
            contact_name = extracted.get("name") or extracted.get("contact_person")
            email_addr = extracted.get("email_id") or extracted.get("email")
            phone = extracted.get("phone")
            
            try:
                lead = await create_lead(
                    db=db,
                    owner_id=owner_id,
                    company_name=company_name,
                    contact_name=contact_name,
                    email=email_addr,
                    phone=str(phone).strip() if phone else None,
                    source="Website",
                    notes=f"Auto-imported from email subject: {email_data['subject']}"
                )
                
                # 4. Insert into website_leads table
                category = "POSH" if "posh" in email_data["subject"].lower() else "Contact Us"
                await db.execute(
                    "INSERT INTO website_leads (lead_id, category, full_data) VALUES (?, ?, ?)",
                    (lead["id"], category, json.dumps(extracted))
                )
                await db.commit()
                
                print(f"[IMAP] Successfully created Website lead assigned to User #{owner_id}")
                
                # 5. Send automated Thank You email if email exists
                if email_addr:
                    # Get template from settings
                    template_key = "posh_thank_you_template" if category == "POSH" else "contact_us_thank_you_template"
                    cursor = await db.execute("SELECT value FROM system_settings WHERE key = ?", (template_key,))
                    row = await cursor.fetchone()
                    template_html = row["value"] if row else (
                        POSH_DEFAULT_TEMPLATE if category == "POSH" else CONTACT_US_DEFAULT_TEMPLATE
                    )
                    
                    # Replace placeholders
                    formatted_html = template_html
                    replacements = {
                        "{{ $json.name }}": str(extracted.get("name") or extracted.get("contact_person") or "N/A"),
                        "{{ $json.email }}": str(extracted.get("email_id") or extracted.get("email") or "N/A"),
                        "{{ $json.phone }}": str(extracted.get("phone") or "N/A"),
                        "{{ $json.company_name }}": str(extracted.get("company_name") or extracted.get("company") or "N/A"),
                        "{{ $json.city }}": str(extracted.get("city") or "N/A"),
                        "{{ $json.services_interested_in }}": str(extracted.get("services_interested_in") or "N/A"),
                        "{{ $json.posh_interest }}": str(extracted.get("posh_interest") or "N/A"),
                        "{{ $json.training_mode }}": str(extracted.get("training_mode") or "N/A"),
                        "{{ $json.number_of_employees }}": str(extracted.get("number_of_employees") or "N/A"),
                        "{{ $json.preferred_timeline }}": str(extracted.get("preferred_timeline") or "N/A"),
                        "{{ $json.requirement_message }}": str(extracted.get("requirement_message") or "N/A"),
                        "{{ $json.website }}": str(extracted.get("website") or "N/A"),
                        "{{ $json.turnover }}": str(extracted.get("turnover") or "N/A"),
                        "{{ $json.employee_size }}": str(extracted.get("employee_size") or "N/A"),
                    }
                    
                    for key, val in replacements.items():
                        formatted_html = formatted_html.replace(key, val)
                        
                    # Send email
                    res = send_email(
                        to_email=email_addr,
                        subject="Thank you for reaching out to D&V Business Consulting",
                        body=formatted_html,
                        html=True
                    )
                    if res["success"]:
                        print(f"[IMAP] Thank You email sent to {email_addr}")
                    else:
                        print(f"[IMAP] Failed to send Thank You email to {email_addr}: {res['message']}")
                        
            except ValueError as e:
                print(f"[IMAP] Duplicate or invalid lead: {e}")
            except Exception as e:
                print(f"[IMAP] DB Error creating lead: {e}")
