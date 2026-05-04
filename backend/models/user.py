"""
User Pydantic models — request/response schemas for authentication.
"""

from pydantic import BaseModel
from typing import Optional


class UserLogin(BaseModel):
    """Schema for login request body."""
    user_id: str
    password: str


class UserCreate(BaseModel):
    """Schema for creating a new user (Admin only)."""
    user_id: str
    password: str
    full_name: str
    role: str = "salesperson"  # default role
    email: str  # Required — used as meeting attendee for salesperson


class UserResponse(BaseModel):
    """Schema for returning user info (never includes password)."""
    id: int
    user_id: str
    full_name: str
    role: str
    email: Optional[str] = None
    is_active: int = 1
    created_at: Optional[str] = None


class TokenResponse(BaseModel):
    """Schema for login response with JWT token."""
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
