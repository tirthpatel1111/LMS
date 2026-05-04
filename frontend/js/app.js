/**
 * app.js — Shared utilities for all pages.
 * Includes: auth helpers, API client, sidebar setup, and common UI functions.
 */

// ──────────────────────────────────────────────
//  Constants
// ──────────────────────────────────────────────
const API_BASE = window.location.origin;
const TOKEN_KEY = 'lms_token';
const USER_KEY = 'lms_user';

// ──────────────────────────────────────────────
//  Auth Utilities
// ──────────────────────────────────────────────
function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

function getUser() {
    const data = localStorage.getItem(USER_KEY);
    return data ? JSON.parse(data) : null;
}

function clearAuth() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
}

function requireAuth() {
    if (!getToken()) {
        window.location.href = '/';
        return false;
    }
    return true;
}

// ──────────────────────────────────────────────
//  API Client (with auto-auth headers)
// ──────────────────────────────────────────────
async function apiGet(path) {
    const response = await fetch(`${API_BASE}${path}`, {
        headers: { 'Authorization': `Bearer ${getToken()}` },
    });
    if (response.status === 401) {
        clearAuth();
        window.location.href = '/';
        return null;
    }
    return response;
}

async function apiPost(path, body) {
    const response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${getToken()}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    if (response.status === 401) {
        clearAuth();
        window.location.href = '/';
        return null;
    }
    return response;
}

async function apiPut(path, body) {
    const response = await fetch(`${API_BASE}${path}`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${getToken()}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    if (response.status === 401) {
        clearAuth();
        window.location.href = '/';
        return null;
    }
    return response;
}

async function apiDelete(path) {
    const response = await fetch(`${API_BASE}${path}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${getToken()}` },
    });
    if (response.status === 401) {
        clearAuth();
        window.location.href = '/';
        return null;
    }
    return response;
}

async function apiUpload(path, formData) {
    const response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}` },
        body: formData,
    });
    if (response.status === 401) {
        clearAuth();
        window.location.href = '/';
        return null;
    }
    return response;
}

// ──────────────────────────────────────────────
//  Sidebar & Layout Setup
// ──────────────────────────────────────────────
function setupLayout() {
    const user = getUser();
    if (!user) return;

    // User info
    const sidebarUserName = document.getElementById('sidebarUserName');
    const sidebarUserRole = document.getElementById('sidebarUserRole');
    const userAvatar = document.getElementById('userAvatar');
    const greetingName = document.getElementById('greetingName');
    const adminSection = document.getElementById('adminSection');

    if (sidebarUserName) sidebarUserName.textContent = user.full_name || user.user_id;
    if (sidebarUserRole) sidebarUserRole.textContent = user.role;
    if (greetingName) greetingName.textContent = user.full_name || user.user_id;

    if (userAvatar) {
        const initials = (user.full_name || user.user_id)
            .split(' ')
            .map(w => w[0])
            .join('')
            .toUpperCase()
            .substring(0, 2);
        userAvatar.textContent = initials;
    }

    if (adminSection && user.role === 'admin') {
        adminSection.classList.remove('hidden');
    }

    // Greeting
    const welcomeText = document.getElementById('welcomeText');
    if (welcomeText) {
        const hour = new Date().getHours();
        if (hour < 12) welcomeText.textContent = 'Good morning! ☀️';
        else if (hour < 17) welcomeText.textContent = 'Good afternoon! 👋';
        else welcomeText.textContent = 'Good evening! 🌙';
    }

    // Sidebar toggle
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const menuToggle = document.getElementById('menuToggle');

    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('show');
            document.body.style.overflow = sidebar.classList.contains('open') ? 'hidden' : '';
        });
    }

    if (overlay) {
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('show');
            document.body.style.overflow = '';
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar) {
            sidebar.classList.remove('open');
            if (overlay) overlay.classList.remove('show');
            document.body.style.overflow = '';
        }
    });

    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            clearAuth();
            window.location.href = '/';
        });
    }

    // Active nav item
    const currentPath = window.location.pathname;
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('href') === currentPath) {
            item.classList.add('active');
        }
    });

    // ── Sidebar Lead Count Badge (all pages) ──────────────────────────────
    // Fetch lead count once on every page load and update the sidebar badge.
    const leadBadge = document.getElementById('leadCount');
    if (leadBadge) {
        apiGet('/api/dashboard/stats').then(res => {
            if (res && res.ok) {
                res.json().then(data => {
                    leadBadge.textContent = (data.leads && data.leads.total) || 0;
                }).catch(() => {});
            }
        }).catch(() => {});
    }

    // ── Self-Delete Account (Salespersons only) ────────────────────────────
    // Admins manage their own account from the Admin Panel user table.
    if (user.role === 'salesperson') {
        const sidebarFooter = document.querySelector('.sidebar-footer');
        if (sidebarFooter) {
            const deleteAccBtn = document.createElement('button');
            deleteAccBtn.id = 'btnDeleteMyAccount';
            deleteAccBtn.style.cssText = [
                'width:100%', 'margin-top:8px', 'padding:8px 12px',
                'background:transparent', 'border:1px solid #FCA5A5',
                'color:#DC2626', 'border-radius:8px', 'font-size:0.8125rem',
                'font-weight:500', 'cursor:pointer', 'display:flex',
                'align-items:center', 'justify-content:center', 'gap:6px',
                'transition:background 0.2s',
            ].join(';');
            deleteAccBtn.innerHTML = '<span>🗑️</span><span>Delete My Account</span>';
            deleteAccBtn.addEventListener('mouseenter', () => { deleteAccBtn.style.background = '#FEF2F2'; });
            deleteAccBtn.addEventListener('mouseleave', () => { deleteAccBtn.style.background = 'transparent'; });
            deleteAccBtn.addEventListener('click', () => {
                withLoadingState(deleteAccBtn, '<span>🗑️</span><span>Processing...</span>', async () => {
                    await deleteSelfAccount(user.id);
                });
            });
            sidebarFooter.appendChild(deleteAccBtn);
        }
    }
}

// ──────────────────────────────────────────────
//  Self-Delete Account (called from sidebar button)
// ──────────────────────────────────────────────
async function deleteSelfAccount(userId) {
    if (!confirm(
        'Are you sure you want to delete YOUR account?\n\n' +
        '⚠️ This will permanently delete:\n' +
        '  • Your account\n' +
        '  • All your leads\n' +
        '  • All your campaigns\n' +
        '  • All your scheduled meetings\n\n' +
        'You will be logged out immediately. This cannot be undone.'
    )) return;

    try {
        const res = await apiDelete(`/api/auth/users/${userId}`);
        if (res && res.ok) {
            showToast('Account deleted. Goodbye!', 'success');
            setTimeout(() => {
                clearAuth();
                window.location.href = '/';
            }, 1200);
        } else {
            const data = await res.json();
            showToast(data.detail || 'Failed to delete account', 'error');
        }
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

// ──────────────────────────────────────────────
//  Loading State Wrapper for Standalone Buttons
// ──────────────────────────────────────────────
async function withLoadingState(btn, loadingText, asyncFn) {
    if (!btn) return;
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = loadingText || 'Processing...';
    try {
        await asyncFn();
    } finally {
        if (document.body.contains(btn)) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
}

// ──────────────────────────────────────────────
//  Toast / Notification
// ──────────────────────────────────────────────
function showToast(message, type = 'success') {
    // Remove existing toast
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
        <span>${message}</span>
    `;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ──────────────────────────────────────────────
//  Modal Helper
// ──────────────────────────────────────────────
function showModal(title, contentHTML, onSave = null) {
    // Remove existing modal
    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="modal-close" id="modalClose">&times;</button>
            </div>
            <div class="modal-body">${contentHTML}</div>
            ${onSave ? '<div class="modal-footer"><button class="btn btn-secondary" id="modalCancel">Cancel</button><button class="btn btn-primary" id="modalSave">Save</button></div>' : ''}
        </div>
    `;
    document.body.appendChild(modal);

    setTimeout(() => modal.classList.add('show'), 10);

    // Close handlers
    const closeModal = () => {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 300);
    };

    document.getElementById('modalClose').addEventListener('click', closeModal);
    if (document.getElementById('modalCancel')) {
        document.getElementById('modalCancel').addEventListener('click', closeModal);
    }
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    if (onSave && document.getElementById('modalSave')) {
        document.getElementById('modalSave').addEventListener('click', async () => {
            const btn = document.getElementById('modalSave');
            const originalText = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Processing...';
            try {
                await onSave(closeModal);
            } finally {
                if (document.body.contains(btn)) {
                    btn.disabled = false;
                    btn.textContent = originalText;
                }
            }
        });
    }

    return closeModal;
}

// ──────────────────────────────────────────────
//  Format Date Utility
// ──────────────────────────────────────────────
function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

// ──────────────────────────────────────────────
//  Status Badge Utility
// ──────────────────────────────────────────────
function statusBadge(status) {
    const colors = {
        new: 'info',
        contacted: 'warning',
        won: 'success',
        approved: 'success',
        lost: 'danger',
        pending: 'warning',
        sent: 'success',
        failed: 'danger',
    };
    const labels = {
        new: 'New',
        contacted: 'Contacted',
        won: 'Approved',
        approved: 'Approved',
        lost: 'Lost',
        pending: 'Pending',
        sent: 'Sent',
        failed: 'Failed',
        email: 'Email',
        whatsapp: 'WhatsApp',
    };
    const label = labels[status] || status;
    return `<span class="badge badge-${colors[status] || 'neutral'}">${label}</span>`;
}

// ──────────────────────────────────────────────
//  Init on page load
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    requireAuth();
    setupLayout();
});
