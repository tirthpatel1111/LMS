/**
 * admin.js — Admin panel logic.
 * Handles user management and settings (SMTP, Interakt).
 */

document.addEventListener('DOMContentLoaded', async () => {
    // Check if user is admin
    const user = getUser();
    if (!user || user.role !== 'admin') {
        showToast('Access denied. Admin only.', 'error');
        setTimeout(() => window.location.href = '/dashboard', 1500);
        return;
    }

    await loadUsers();
    await loadSMTPSettings();
    await loadIMAPSettings();
    await loadInteraktSettings();
    await loadWhatsAppTemplates();
    await loadEmailTemplates();
    await loadGoogleCalendarSettings();
    await loadThankYouTemplates();
    setupAdminActions();
});

// ──────────────────────────────────────────────
//  User Management
// ──────────────────────────────────────────────
async function loadUsers() {
    try {
        const res = await apiGet('/api/auth/users');
        if (!res || !res.ok) return;
        const users = await res.json();
        const currentUser = getUser();

        // Count how many admin accounts exist in the system
        const totalAdmins = users.filter(u => u.role === 'admin').length;
        const isLastAdmin = totalAdmins === 1;

        const tbody = document.getElementById('usersTableBody');
        tbody.innerHTML = users.map(u => {
            const isSelf = currentUser && u.id === currentUser.id;
            const isSelfAndLastAdmin = isLastAdmin && isSelf && u.role === 'admin';

            // Build the delete button
            let deleteBtn;
            if (isSelfAndLastAdmin) {
                // Disabled — last admin cannot self-delete
                // No onclick — fully blocked (keyboard + mouse)
                deleteBtn = `
                    <button
                        class="btn btn-sm"
                        disabled
                        title="You are the last admin. Create another admin account first before deleting this one."
                        style="opacity:0.35;cursor:not-allowed;background:linear-gradient(135deg,#EF4444,#DC2626);color:white;pointer-events:none;"
                    >🗑️</button>`;
            } else {
                deleteBtn = `
                    <button
                        class="btn btn-sm btn-danger"
                        onclick="deleteUser(${u.id}, this)"
                        title="Delete User &amp; all their data"
                    >🗑️</button>`;
            }

            return `
            <tr>
                <td>${u.id}</td>
                <td><strong>${u.user_id}</strong>${isSelf ? ' <span style="font-size:0.7rem;color:#6B7280;">(you)</span>' : ''}</td>
                <td>${u.full_name}</td>
                <td>${u.role === 'admin' ? '<span class="badge badge-danger">Admin</span>' : '<span class="badge badge-info">Salesperson</span>'}</td>
                <td>${u.email || '-'}</td>
                <td>${u.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-neutral">Inactive</span>'}</td>
                <td>${formatDate(u.created_at)}</td>
                <td>${deleteBtn}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error('Failed to load users:', err);
    }
}

async function deleteUser(userId, btn) {
    // Double-check: if this is an admin account and the last one, block here too
    try {
        const usersRes = await apiGet('/api/auth/users');
        if (usersRes && usersRes.ok) {
            const allUsers = await usersRes.json();
            const currentUser = getUser();
            const targetUser = allUsers.find(u => u.id === userId);
            const totalAdmins = allUsers.filter(u => u.role === 'admin').length;
            if (targetUser && targetUser.role === 'admin' && totalAdmins <= 1 && currentUser && currentUser.id === userId) {
                showToast('You are the last admin. Create another admin account first before deleting this one.', 'error');
                return;
            }
        }
    } catch (_) { /* proceed to server-side check */ }

    if (!confirm(
        'Are you sure you want to delete this user?\n\n' +
        '⚠️ This will permanently delete:\n' +
        '  • Their account\n' +
        '  • All their leads\n' +
        '  • All their campaigns\n' +
        '  • All their scheduled meetings\n\n' +
        'This action cannot be undone.'
    )) return;

    withLoadingState(btn, '🗑️...', async () => {
        try {
            const res = await apiDelete(`/api/auth/users/${userId}`);
            if (res.ok) {
                showToast('User and all their data deleted successfully', 'success');
                // If user deleted their own account, log out
                const currentUser = getUser();
                if (currentUser && currentUser.id === userId) {
                    clearAuth();
                    window.location.href = '/';
                    return;
                }
                await loadUsers();
            } else {
                const err = await res.json();
                showToast(err.detail || 'Failed to delete user', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    });
}


function setupAdminActions() {
    // Add user
    document.getElementById('btnAddUser').addEventListener('click', () => {
        const html = `
            <div class="form-group">
                <label for="newUserId">Username</label>
                <input type="text" id="newUserId" class="form-input" style="padding-left:14px;" placeholder="e.g., john">
            </div>
            <div class="form-group">
                <label for="newPassword">Password</label>
                <input type="password" id="newPassword" class="form-input" style="padding-left:14px;" placeholder="Strong password">
            </div>
            <div class="form-group">
                <label for="newFullName">Full Name</label>
                <input type="text" id="newFullName" class="form-input" style="padding-left:14px;" placeholder="John Doe">
            </div>
            <div class="form-group">
                <label for="newRole">Role</label>
                <select id="newRole" class="form-input filter-select" style="padding-left:14px;width:100%;">
                    <option value="salesperson">Salesperson</option>
                    <option value="admin">Admin</option>
                </select>
            </div>
            <div class="form-group">
                <label for="newEmail">Email <span style="color:#EF4444;">*</span></label>
                <input type="email" id="newEmail" class="form-input" style="padding-left:14px;" placeholder="john@company.com" required>
            </div>
        `;

        showModal('Add New User', html, async (close) => {
            const body = {
                user_id: document.getElementById('newUserId').value,
                password: document.getElementById('newPassword').value,
                full_name: document.getElementById('newFullName').value,
                role: document.getElementById('newRole').value,
                email: document.getElementById('newEmail').value.trim(),
            };

            if (!body.user_id || !body.password || !body.full_name || !body.email) {
                showToast('Please fill in all required fields (including email)', 'error');
                return;
            }

            try {
                const res = await apiPost('/api/auth/users', body);
                if (res.ok) {
                    showToast('User created successfully!', 'success');
                    close();
                    await loadUsers();
                } else {
                    const err = await res.json();
                    showToast(err.detail || 'Failed to create user', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
    });

    // Save SMTP
    const btnSaveSMTP = document.getElementById('btnSaveSMTP');
    btnSaveSMTP.addEventListener('click', async () => {
        withLoadingState(btnSaveSMTP, 'Saving...', async () => {
            const config = {
                host: document.getElementById('smtpHost').value,
                port: parseInt(document.getElementById('smtpPort').value) || 587,
                username: document.getElementById('smtpUsername').value,
                password: document.getElementById('smtpPassword').value,
                from_email: document.getElementById('smtpFromEmail').value,
                from_name: document.getElementById('smtpFromName').value,
                use_tls: true,
            };

            try {
                const res = await apiPost('/api/campaigns/settings/smtp', config);
                const data = await res.json();
                if (res.ok) {
                    showToast('SMTP settings saved!', 'success');
                    updateSmtpStatus(data.configured);
                } else {
                    showToast(data.detail || 'Failed to save', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
    });

    // Save IMAP
    const btnSaveIMAP = document.getElementById('btnSaveIMAP');
    btnSaveIMAP.addEventListener('click', async () => {
        withLoadingState(btnSaveIMAP, 'Saving...', async () => {
            const config = {
                host: document.getElementById('imapHost').value,
                port: parseInt(document.getElementById('imapPort').value) || 993,
                username: document.getElementById('imapUsername').value,
                password: document.getElementById('imapPassword').value,
                use_tls: true,
            };

            try {
                const res = await apiPost('/api/campaigns/settings/imap', config);
                const data = await res.json();
                if (res.ok) {
                    showToast('IMAP settings saved!', 'success');
                    updateImapStatus(data.configured);
                } else {
                    showToast(data.detail || 'Failed to save', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
    });

    // Save Interakt
    const btnSaveInterakt = document.getElementById('btnSaveInterakt');
    btnSaveInterakt.addEventListener('click', async () => {
        withLoadingState(btnSaveInterakt, 'Saving...', async () => {
            const apiKeyVal = document.getElementById('interaktApiKey').value;
            const config = {
                language_code: document.getElementById('interaktLang').value || 'en',
            };
            // Only include api_key if not masked placeholder
            if (apiKeyVal && !apiKeyVal.endsWith('***')) {
                config.api_key = apiKeyVal;
            }

            try {
                const res = await apiPost('/api/campaigns/settings/interakt', config);
                const data = await res.json();
                if (res.ok) {
                    showToast('Interakt settings saved!', 'success');
                    updateInteraktStatus(data.configured);
                } else {
                    showToast(data.detail || 'Failed to save', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
    });

    // Add WhatsApp Template
    const btnAddTemplate = document.getElementById('btnAddTemplate');
    btnAddTemplate.addEventListener('click', async () => {
        withLoadingState(btnAddTemplate, 'Adding...', async () => {
            const name = document.getElementById('newTemplateName').value.trim();
            const code_name = document.getElementById('newTemplateCode').value.trim();
            
            if (!name || !code_name) {
                showToast('Both Name and Code Name are required', 'error');
                return;
            }
            
            try {
                const res = await apiPost('/api/campaigns/settings/whatsapp-templates', { name, code_name });
                if (res.ok) {
                    showToast('Template added successfully!', 'success');
                    document.getElementById('newTemplateName').value = '';
                    document.getElementById('newTemplateCode').value = '';
                    await loadWhatsAppTemplates();
                } else {
                    const data = await res.json();
                    showToast(data.detail || 'Failed to add template', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
    });

    // Add Email Template
    const btnAddEmailTemplate = document.getElementById('btnAddEmailTemplate');
    btnAddEmailTemplate.addEventListener('click', async () => {
        withLoadingState(btnAddEmailTemplate, 'Adding...', async () => {
            const name = document.getElementById('newEmailTemplateName').value.trim();
            const html_body = document.getElementById('newEmailTemplateBody').value.trim();
            
            if (!name || !html_body) {
                showToast('Both Name and HTML Content are required', 'error');
                return;
            }
            
            try {
                const res = await apiPost('/api/campaigns/settings/email-templates', { name, html_body });
                if (res.ok) {
                    showToast('Email Template added successfully!', 'success');
                    document.getElementById('newEmailTemplateName').value = '';
                    document.getElementById('newEmailTemplateBody').value = '';
                    await loadEmailTemplates();
                } else {
                    const data = await res.json();
                    showToast(data.detail || 'Failed to add template', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
    });

    // Save Google Calendar
    const btnSaveGCal = document.getElementById('btnSaveGCal');
    btnSaveGCal.addEventListener('click', async () => {
        withLoadingState(btnSaveGCal, 'Saving...', async () => {
            const config = {
                client_id: document.getElementById('gcalClientId').value,
                client_secret: document.getElementById('gcalClientSecret').value,
                refresh_token: document.getElementById('gcalRefreshToken').value,
                calendar_email: document.getElementById('gcalEmail').value,
            };

            if (!config.calendar_email) {
                showToast('Please enter the Admin Calendar Email', 'error');
                return;
            }

            try {
                const res = await apiPost('/api/campaigns/settings/google-calendar', config);
                const data = await res.json();
                if (res.ok) {
                    showToast('Google Calendar settings saved!', 'success');
                    updateGcalStatus(data.configured);
                } else {
                    showToast(data.detail || 'Failed to save', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
    });

    // Save Thank You Templates
    const btnSaveTemplates = document.getElementById('btnSaveTemplates');
    btnSaveTemplates.addEventListener('click', async () => {
        withLoadingState(btnSaveTemplates, 'Saving...', async () => {
            const posh = document.getElementById('poshTemplate').value;
            const contact_us = document.getElementById('contactUsTemplate').value;

            try {
                const res = await apiPost('/api/campaigns/settings/thank-you-templates', { posh, contact_us });
                if (res.ok) {
                    showToast('Thank You Templates saved!', 'success');
                } else {
                    const data = await res.json();
                    showToast(data.detail || 'Failed to save templates', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
    });

    // Delete POSH Template
    const btnDeletePoshTemplate = document.getElementById('btnDeletePoshTemplate');
    btnDeletePoshTemplate.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to delete the POSH template? It will be reset to default.')) return;
        withLoadingState(btnDeletePoshTemplate, 'Deleting...', async () => {
            try {
                const res = await apiDelete('/api/campaigns/settings/thank-you-templates/posh');
                if (res.ok) {
                    showToast('POSH template reset to default', 'success');
                    await loadThankYouTemplates();
                } else {
                    showToast('Failed to delete template', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
    });

    // Delete Contact Us Template
    const btnDeleteContactTemplate = document.getElementById('btnDeleteContactTemplate');
    btnDeleteContactTemplate.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to delete the Contact Us template? It will be reset to default.')) return;
        withLoadingState(btnDeleteContactTemplate, 'Deleting...', async () => {
            try {
                const res = await apiDelete('/api/campaigns/settings/thank-you-templates/contact_us');
                if (res.ok) {
                    showToast('Contact Us template reset to default', 'success');
                    await loadThankYouTemplates();
                } else {
                    showToast('Failed to delete template', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
    });
}

// ──────────────────────────────────────────────
//  Load Settings
// ──────────────────────────────────────────────
async function loadSMTPSettings() {
    try {
        const res = await apiGet('/api/campaigns/settings/smtp');
        if (!res || !res.ok) return;
        const data = await res.json();

        document.getElementById('smtpHost').value = data.host || '';
        document.getElementById('smtpPort').value = data.port || 587;
        document.getElementById('smtpUsername').value = data.username || '';
        document.getElementById('smtpPassword').value = data.password || '';
        document.getElementById('smtpFromEmail').value = data.from_email || '';
        document.getElementById('smtpFromName').value = data.from_name || 'Lead Manager';
        updateSmtpStatus(data.configured);
    } catch (err) {
        console.error('Failed to load SMTP settings:', err);
    }
}

async function loadIMAPSettings() {
    try {
        const res = await apiGet('/api/campaigns/settings/imap');
        if (!res || !res.ok) return;
        const data = await res.json();

        document.getElementById('imapHost').value = data.host || '';
        document.getElementById('imapPort').value = data.port || 993;
        document.getElementById('imapUsername').value = data.username || '';
        document.getElementById('imapPassword').value = data.password || '';
        updateImapStatus(data.configured);
    } catch (err) {
        console.error('Failed to load IMAP settings:', err);
    }
}

async function loadInteraktSettings() {
    try {
        const res = await apiGet('/api/campaigns/settings/interakt');
        if (!res || !res.ok) return;
        const data = await res.json();

        document.getElementById('interaktApiKey').value  = data.api_key       || '';
        document.getElementById('interaktLang').value     = data.language_code || 'en';
        updateInteraktStatus(data.configured);
    } catch (err) {
        console.error('Failed to load Interakt settings:', err);
    }
}

async function loadWhatsAppTemplates() {
    try {
        const res = await apiGet('/api/campaigns/settings/whatsapp-templates');
        if (!res || !res.ok) return;
        const templates = await res.json();
        
        const tbody = document.getElementById('templatesTableBody');
        if (templates.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="padding:20px;color:#9CA3AF;">No templates added yet.</td></tr>';
            return;
        }
        
        tbody.innerHTML = templates.map(t => `
            <tr>
                <td><strong>${t.name}</strong></td>
                <td><code style="background:#F3F4F6;padding:2px 6px;border-radius:4px;">${t.code_name}</code></td>
                <td>${formatDate(t.created_at)}</td>
                <td>
                    <button class="btn btn-sm btn-danger" onclick="deleteWhatsAppTemplate(${t.id}, this)" title="Delete Template">🗑️</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Failed to load WhatsApp templates:', err);
    }
}

window.deleteWhatsAppTemplate = async function(id, btn) {
    if (!confirm('Are you sure you want to delete this template?')) return;
    withLoadingState(btn, '🗑️...', async () => {
        try {
            const res = await apiDelete(`/api/campaigns/settings/whatsapp-templates/${id}`);
            if (res.ok) {
                showToast('Template deleted', 'success');
                await loadWhatsAppTemplates();
            } else {
                const err = await res.json();
                showToast(err.detail || 'Failed to delete template', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    });
}

async function loadEmailTemplates() {
    try {
        const res = await apiGet('/api/campaigns/settings/email-templates');
        if (!res || !res.ok) return;
        const templates = await res.json();
        
        const tbody = document.getElementById('emailTemplatesTableBody');
        if (templates.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center" style="padding:20px;color:#9CA3AF;">No email templates added yet.</td></tr>';
            return;
        }
        
        tbody.innerHTML = templates.map(t => `
            <tr>
                <td><strong>${t.name}</strong></td>
                <td>${formatDate(t.created_at)}</td>
                <td>
                    <button class="btn btn-sm btn-danger" onclick="deleteEmailTemplate(${t.id}, this)" title="Delete Template">🗑️</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Failed to load Email templates:', err);
    }
}

window.deleteEmailTemplate = async function(id, btn) {
    if (!confirm('Are you sure you want to delete this email template?')) return;
    withLoadingState(btn, '🗑️...', async () => {
        try {
            const res = await apiDelete(`/api/campaigns/settings/email-templates/${id}`);
            if (res.ok) {
                showToast('Email Template deleted', 'success');
                await loadEmailTemplates();
            } else {
                const err = await res.json();
                showToast(err.detail || 'Failed to delete template', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    });
}

async function loadGoogleCalendarSettings() {
    try {
        const res = await apiGet('/api/campaigns/settings/google-calendar');
        if (!res || !res.ok) return;
        const data = await res.json();

        document.getElementById('gcalClientId').value = data.client_id || '';
        document.getElementById('gcalClientSecret').value = data.client_secret || '';
        document.getElementById('gcalRefreshToken').value = data.refresh_token || '';
        document.getElementById('gcalEmail').value = data.calendar_email || '';
        updateGcalStatus(data.configured);
    } catch (err) {
        console.error('Failed to load Google Calendar settings:', err);
    }
}

function updateSmtpStatus(configured) {
    const badge = document.getElementById('smtpStatus');
    if (configured) {
        badge.className = 'badge badge-success';
        badge.textContent = 'Configured';
    } else {
        badge.className = 'badge badge-warning';
        badge.textContent = 'Not Configured';
    }
}

function updateImapStatus(configured) {
    const badge = document.getElementById('imapStatus');
    if (!badge) return;
    if (configured) {
        badge.className = 'badge badge-success';
        badge.textContent = 'Configured';
    } else {
        badge.className = 'badge badge-warning';
        badge.textContent = 'Not Configured';
    }
}

function updateInteraktStatus(configured) {
    const badge = document.getElementById('interaktStatus');
    if (!badge) return;
    if (configured) {
        badge.className = 'badge badge-success';
        badge.textContent = 'Configured';
    } else {
        badge.className = 'badge badge-warning';
        badge.textContent = 'Not Configured';
    }
}

function updateGcalStatus(configured) {
    const badge = document.getElementById('gcalStatus');
    if (!badge) return;
    if (configured) {
        badge.className = 'badge badge-success';
        badge.textContent = 'Configured';
    } else {
        badge.className = 'badge badge-warning';
        badge.textContent = 'Not Configured';
    }
}

async function loadThankYouTemplates() {
    try {
        const res = await apiGet('/api/campaigns/settings/thank-you-templates');
        if (!res || !res.ok) return;
        const data = await res.json();
        
        document.getElementById('poshTemplate').value = data.posh || '';
        document.getElementById('contactUsTemplate').value = data.contact_us || '';
    } catch (err) {
        console.error('Failed to load Thank You templates:', err);
    }
}
