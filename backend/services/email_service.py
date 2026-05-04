"""
Email Service — Send emails using SMTP.
Supports HTML and plain-text emails with configurable SMTP settings.
"""

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart


from dotenv import load_dotenv, set_key
import os
from backend.services.encryption_service import encrypt_text, decrypt_text

# Load environment variables
load_dotenv()
ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")

# ──────────────────────────────────────────────
#  SMTP Configuration
#  Configure these settings via the Admin panel
#  or set them as environment variables.
# ──────────────────────────────────────────────
SMTP_CONFIG = {
    "host": os.getenv("SMTP_HOST", ""),
    "port": int(os.getenv("SMTP_PORT", 587)),
    "username": os.getenv("SMTP_USERNAME", ""),
    "password": decrypt_text(os.getenv("SMTP_PASSWORD", "")),
    "from_email": os.getenv("SMTP_FROM_EMAIL", ""),
    "from_name": os.getenv("SMTP_FROM_NAME", "Lead Manager"),
    "use_tls": os.getenv("SMTP_USE_TLS", "True").lower() == "true",
}


def is_smtp_configured() -> bool:
    """Check if SMTP settings are configured."""
    return bool(SMTP_CONFIG["host"] and SMTP_CONFIG["username"] and SMTP_CONFIG["password"])


def update_smtp_config(config: dict):
    """
    Update SMTP configuration at runtime and persist to .env.
    Called from the Admin settings panel.
    """
    if not os.path.exists(ENV_PATH):
        open(ENV_PATH, 'a').close()

    for key, val in config.items():
        if key in SMTP_CONFIG:
            # If the value is for password and it comes as "***", it means admin didn't change it.
            if key == "password" and val == "***":
                continue
            
            SMTP_CONFIG[key] = val
            env_key = f"SMTP_{key.upper()}"
            
            # Encrypt password before saving
            save_val = str(val)
            if key == "password":
                save_val = encrypt_text(val)
                
            set_key(ENV_PATH, env_key, save_val)


def send_email(
    to_email: str,
    subject: str,
    body: str,
    html: bool = False,
) -> dict:
    """
    Send an email via SMTP.
    
    Args:
        to_email: Recipient email address
        subject: Email subject line
        body: Email body (plain text or HTML)
        html: If True, body is treated as HTML
    
    Returns:
        dict with 'success' (bool) and 'message' (str)
    """
    if not is_smtp_configured():
        return {
            "success": False,
            "message": "SMTP is not configured. Go to Settings to configure email.",
        }

    try:
        # Build the email message
        msg = MIMEMultipart("alternative")
        msg["From"] = f"{SMTP_CONFIG['from_name']} <{SMTP_CONFIG['from_email'] or SMTP_CONFIG['username']}>"
        msg["To"] = to_email
        msg["Subject"] = subject

        # Attach body
        content_type = "html" if html else "plain"
        msg.attach(MIMEText(body, content_type, "utf-8"))

        # Connect and send
        server = smtplib.SMTP(SMTP_CONFIG["host"], SMTP_CONFIG["port"])
        server.ehlo()
        if SMTP_CONFIG["use_tls"]:
            server.starttls()
            server.ehlo()
        server.login(SMTP_CONFIG["username"], SMTP_CONFIG["password"])
        server.sendmail(
            SMTP_CONFIG["from_email"] or SMTP_CONFIG["username"],
            to_email,
            msg.as_string(),
        )
        server.quit()

        return {"success": True, "message": f"Email sent successfully to {to_email}"}

    except smtplib.SMTPAuthenticationError:
        return {"success": False, "message": "SMTP authentication failed. Check username/password."}
    except smtplib.SMTPConnectError:
        return {"success": False, "message": f"Could not connect to SMTP server {SMTP_CONFIG['host']}:{SMTP_CONFIG['port']}"}
    except Exception as e:
        return {"success": False, "message": f"Email failed: {str(e)}"}
